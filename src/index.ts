import {Elysia, t} from "elysia";
import {cors} from "@elysiajs/cors";
import {Client, PlaceInputType} from "@googlemaps/google-maps-services-js";
import {createClient} from "@deepgram/sdk";
import {GoogleGenerativeAI} from "@google/generative-ai";
import sharp from "sharp";
import ffmpeg from "fluent-ffmpeg";
import ffmpegPath from "ffmpeg-static";
import fs from "fs";

const port = (process.env.PORT || 3000) as number;
const GMAPS_KEY = process.env.GMAPS_KEY!;
const DEEPGRAM_KEY = process.env.DEEPGRAM_KEY!;
const TW_STT = process.env.TW_STT!;
const GEMINI_KEY = process.env.GEMINI_KEY!;
const STABILITY_KEY = process.env.STABILITY_KEY!;

const gmaps = new Client();
const deepgram = createClient(DEEPGRAM_KEY);
const gemini = new GoogleGenerativeAI(GEMINI_KEY);
ffmpeg.setFfmpegPath(ffmpegPath!);

const app = new Elysia()
    .get("/", () => ({message: `The server is working on port: ${port}`}))
    .post(
        "/find-place",
        async ({body}) => {
            const {query} = body;
            const response = await gmaps.findPlaceFromText({
                params: {
                    key: GMAPS_KEY,
                    fields: ["geometry"],
                    input: query,
                    inputtype: PlaceInputType.textQuery,
                },
            });

            // Response check
            if (response.data.error_message)
                throw new Error(response.data.error_message);
            const location = response.data.candidates?.[0]?.geometry?.location;
            if (!location) throw new Error("No location found");

            return {location};
        },
        {body: t.Object({query: t.String()})}
    )
    .post(
        "/static-streetview",
        async ({body}) => {
            const {panoID, heading, pitch} = body;
            const url = `https://maps.googleapis.com/maps/api/streetview?size=640x640&key=${GMAPS_KEY}&pano=${panoID}&heading=${heading}&pitch=${pitch}`;
            const gmaps_res = await fetch((await fetch(url)).url);
            return await gmaps_res.blob();
        },
        {
            body: t.Object({
                panoID: t.String(),
                heading: t.Numeric(),
                pitch: t.Numeric(),
            }),
        }
    )
    // Audio 90% less time by switching to Deepgram Nova-2, plus zh-tw support
    .post(
        "/stt",
        async ({body}) => {
            const {language, audio} = body;
            let transcript = "";
            if (language === "zh") {
                const {result, error} =
                    await deepgram.listen.prerecorded.transcribeFile(
                        Buffer.from(await audio.arrayBuffer()),
                        {
                            model: "nova-2",
                            language: "zh-TW",
                        }
                    );
                if (error) throw new Error(error.message);
                console.log(result);
                transcript = result?.results?.channels[0]?.alternatives[0]?.transcript;
            } else if (language === "tw") {
                const data = {
                    token: TW_STT,
                    audio_data: Buffer.from(await audio.arrayBuffer()).toString("base64"),
                    audio_format: "webm",
                    service_id: "A018",
                    mode: "Segmentation",
                };

                const response = await fetch("http://140.116.245.149:2802/asr", {
                    method: "POST",
                    body: JSON.stringify(data),
                    headers: {
                        "Content-Type": "application/json",
                    },
                });
                if (!response.ok) throw new Error("Failed to transcribe audio");
                const {words_list} = (await response.json()) as {
                    words_list: string[];
                };
                transcript = words_list[0].replace(/\s/g, "");
            } else {
                throw new Error("Unsupported language");
            }

            return {transcript, language};
        },
        {body: t.Object({language: t.String(), audio: t.File()})}
    )
    // Switch to gemini-1.5-flash-latest for better results
    .post(
        "/prompt-gen",
        async ({body}) => {
            const {prompt} = body;
            const model = gemini.getGenerativeModel({
                model: "gemini-1.5-flash-latest",
            });
            const gemini_prompt = `
            Create a stable diffusion prompt, the prompt should accurately the scene in the story. 
            The prompt should clearly specify the subjects or elements to be included in the generated image. 
            The desired style of the image should be photo-realistic, this should be explicitly stated in the prompt. 
            The color palette for the image should be "vintage," indicating a muted, nostalgic, or aged look. 
            The prompt should be written in English.
            Here are examples of prompts for different styles: "horror, shines a lighter on himself from below, Face lighting from below, bottom view, lighter in hands, 8k", "valley, fairytale treehouse village covered , matte painting, highly detailed, dynamic lighting, cinematic, realism, realistic, photo real, sunset, detailed, high contrast, denoised, centered", "Mountains, painted, intricate, volumetric lighting, beautiful, rich deep colors masterpiece, sharp focus, ultra detailed, in the style of dan mumford and marc simonetti", "A solo redhead woman, with blue eyes and long hair styled on one side up, is captured in a photo flirting to the camera while holding an electric guitar, wearing a black skirt and pleated skirt, while wearing headphones and showcasing her mesmerizing red lips". 
            The story: ${prompt}`;

            const newPrompt = (
                await model.generateContent(gemini_prompt)
            ).response.text();

            return {prompt: newPrompt};
        },
        {
            body: t.Object({prompt: t.String()}),
        }
    )
    // Better stability.ai config
    .post(
        "image-to-image",
        async ({body}) => {
            const {image, prompt} = body;
            const formData = new FormData();
            formData.append("init_image_mode", "IMAGE_STRENGTH");
            formData.append("image_strength", "0.55");
            formData.append("cfg_scale", "20");
            formData.append("clip_guidance_preset", "FAST_BLUE");
            formData.append("init_image", image, "image.jpg");
            formData.append("text_prompts[0][text]", prompt);
            formData.append("text_prompts[0][weight]", "1");

            const stability_res = await fetch(
                "https://api.stability.ai/v1/generation/stable-diffusion-xl-1024-v1-0/image-to-image",
                {
                    method: "POST",
                    headers: {
                        Authorization: `Bearer ${STABILITY_KEY}`,
                        accept: "image/png",
                    },
                    body: formData,
                }
            );

            if (!stability_res.ok) {
                throw new Error("Failed to generate image");
            }

            const final_image = await sharp(await stability_res.arrayBuffer())
                .jpeg({
                    quality: 90,
                })
                .toBuffer();

            return new Blob([final_image], {type: "image/jpeg"});
        },
        {
            body: t.Object({image: t.File(), prompt: t.String()}),
        }
    )
    .post(
        "/to-video",
        async ({body}) => {
            const {image, audio} = body;

            // Combine jpeg and audio
            await Bun.write("temp-image.jpeg", image);
            await Bun.write("temp-audio.webm", audio);
            await new Promise<void>((resolve, reject) => {
                ffmpeg()
                    .input("temp-image.jpeg")
                    .inputFPS(30)
                    .input("temp-audio.webm")
                    .outputOptions([
                        '-vf', "zoompan=z='min(max(zoom,pzoom)+0.0055,5.5)':d=30:x='iw/2':y='ih/2':s=1024x1024"
                    ])
                    .output("output.mp4")
                    .videoCodec("libx264")
                    .audioCodec("libopus")
                    .on("end", () => {
                        console.log("Finished processing");
                        fs.unlinkSync("temp-image.jpeg");
                        fs.unlinkSync("temp-audio.webm");
                        resolve();
                    })
                    .on("error", reject)
                    .run();
            });

            return Buffer.from(await Bun.file("output.mp4").arrayBuffer());
        },
        {
            body: t.Object({image: t.File(), audio: t.File()}),
        }
    )
    .onError(({code}) => {
        if (code === "NOT_FOUND") return "Route not found :(";
    })
    .use(cors())
    .listen(port);

console.log(
    `🦊 Elysia is running at ${app.server?.hostname}:${app.server?.port}`
);
