import { Elysia, t } from "elysia";
import { cors } from "@elysiajs/cors";
import { Client, PlaceInputType } from "@googlemaps/google-maps-services-js";
import { createClient } from "@deepgram/sdk";
import { GoogleGenerativeAI } from "@google/generative-ai";
import sharp from "sharp";
import ffmpeg from "fluent-ffmpeg";
import ffmpegPath from "ffmpeg-static";
import fs from "fs";
import { config } from "./config";

const port = Number(process.env.PORT) || 3000;
const gmaps = new Client();
const deepgram = createClient(config.DEEPGRAM_KEY);
const gemini = new GoogleGenerativeAI(config.GEMINI_KEY);
ffmpeg.setFfmpegPath(ffmpegPath!);

const app = new Elysia()
  .get("/", () => ({ message: `The server is working on port: ${port}` }))

  .post(
    "/find-place",
    async ({ body }) => {
      const { query } = body;
      const response = await gmaps.findPlaceFromText({
        params: {
          key: config.GMAPS_KEY,
          fields: ["geometry"],
          input: query,
          inputtype: PlaceInputType.textQuery,
        },
      });

      if (response.data.error_message)
        throw new Error(response.data.error_message);
      const location = response.data.candidates?.[0]?.geometry?.location;
      if (!location) throw new Error("No location found");

      return { location };
    },
    { body: t.Object({ query: t.String() }) }
  )

  .post(
    "/static-streetview",
    async ({ body }) => {
      const { panoID, heading, pitch } = body;
      const url = `https://maps.googleapis.com/maps/api/streetview?size=640x640&key=${config.GMAPS_KEY}&pano=${panoID}&heading=${heading}&pitch=${pitch}`;
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

  .post(
    "/stt",
    async ({ body }) => {
      const { language, audio } = body;
      const { result, error } =
        await deepgram.listen.prerecorded.transcribeFile(
          Buffer.from(await audio.arrayBuffer()),
          { model: "nova-2", language: "zh-TW" }
        );
      if (error) throw new Error(error.message);

      const transcript =
        result?.results?.channels[0]?.alternatives[0]?.transcript;
      return { transcript, language };
    },
    { body: t.Object({ language: t.String(), audio: t.File() }) }
  )

  .post(
    "/prompt-gen",
    async ({ body }) => {
      const { prompt } = body;
      const model = gemini.getGenerativeModel({
        model: "gemini-2.0-flash-exp",
        generationConfig: { temperature: 0.3 },
      });

      const gemini_prompt = `
        Summarize the story into a stable diffusion prompt.
        Be concise, less than 200 words.
        The story: ${prompt}`;

      const newPrompt = (
        await model.generateContent(gemini_prompt)
      ).response.text();
      return { prompt: newPrompt };
    },
    { body: t.Object({ prompt: t.String() }) }
  )

  .post(
    "image-to-image",
    async ({ body }) => {
      const { image, prompt } = body;
      const formData = new FormData();
      formData.append("init_image_mode", "IMAGE_STRENGTH");
      formData.append("image_strength", "0.55");
      formData.append("cfg_scale", "20");
      formData.append("clip_guidance_preset", "FAST_BLUE");
      formData.append(
        "init_image",
        new Blob([await image.arrayBuffer()], { type: image.type }),
        "image.jpg"
      );
      formData.append("text_prompts[0][text]", prompt.slice(0, 2000));
      formData.append("text_prompts[0][weight]", "1");

      const stability_res = await fetch(
        "https://api.stability.ai/v1/generation/stable-diffusion-v1-6/image-to-image",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${config.STABILITY_KEY}`,
            accept: "image/png",
          },
          body: formData,
        }
      );

      if (!stability_res.ok) {
        const errorMessage = await stability_res.text();
        throw new Error(`Failed to generate image: ${errorMessage}`);
      }

      const final_image = await sharp(await stability_res.arrayBuffer())
        .jpeg({ quality: 90 })
        .toBuffer();

      return new Blob([final_image], { type: "image/jpeg" });
    },
    { body: t.Object({ image: t.File(), prompt: t.String() }) }
  )

  .post(
    "/to-video",
    async ({ body }) => {
      const { image, audio, prompt } = body;
      const wrappedPrompt = (prompt.match(/.{1,30}/g) ?? []).join("\n");

      await Bun.write("temp-image.jpeg", image);
      await Bun.write("temp-audio.webm", audio);
      await new Promise<void>((resolve, reject) => {
        ffmpeg()
          .input("temp-image.jpeg")
          .inputFPS(30)
          .input("temp-audio.webm")
          .outputOptions([
            `-vf zoompan=z='max(zoom,pzoom)+0.001':500:x='iw/2':y='ih/2':s=1024x1024`,
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
    { body: t.Object({ image: t.File(), audio: t.File(), prompt: t.String() }) }
  )

  .onError(({ code }) => {
    if (code === "NOT_FOUND") return "Route not found :(";
  })

  .use(cors())
  .listen(port);

console.log(
  `🦊 Elysia is running at ${app.server?.hostname}:${app.server?.port}`
);
