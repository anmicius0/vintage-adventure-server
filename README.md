# Vintage Adventure Server (Elysia)

This project provides a backend server for the Vintage Adventure application, built using the Elysia framework in Bun. It leverages various APIs and libraries to handle functionalities such as location finding, street view image retrieval, speech-to-text conversion, prompt generation, and image/video processing.

## Dependencies

The project utilizes the following key dependencies:

- **Elysia:** A fast and lightweight web framework for Bun.
- **@elysiajs/cors:** Enables Cross-Origin Resource Sharing (CORS) for the server.
- **@googlemaps/google-maps-services-js:** Interacts with the Google Maps API for location-based services.
- **@deepgram/sdk:** Provides speech-to-text transcription using Deepgram's API.
- **@google/generative-ai:** Accesses Google's Gemini API for AI-powered prompt generation.
- **sharp:** Performs image processing tasks, such as resizing and format conversion.
- **ffmpeg:** Handles video processing, including combining images and audio.
- **ffmpeg-static:** Provides a statically linked version of FFmpeg for easier deployment.
- **dotenv:** Loads environment variables from a `.env` file.

## Environment Variables

Ensure you have a `.env` file in the root directory with the following environment variables:

```
GMAPS_KEY=<Your Google Maps API Key>
DEEPGRAM_KEY=<Your Deepgram API Key>
GEMINI_KEY=<Your Google Gemini API Key>
STABILITY_KEY=<Your Stability AI API Key>
PORT=<Your desired port number (default: 3000)>
```

## Installation

1. Clone the repository:
   ```bash
   git clone <repository_url>
   ```
2. Navigate to the project directory:
   ```bash
   cd vintage-adventure-server-elysia
   ```
3. Install dependencies:
   ```bash
   bun install
   ```

## Starting the Server

To start the development server, run:

```bash
bun dev
```

This will start the server in watch mode, automatically restarting it whenever changes are made to the source code.

To start the server in production mode, run:

```bash
bun start
```

## Maintenance

- **API Keys:** Ensure your API keys are kept secure and updated as needed.
- **Dependencies:** Regularly update dependencies to benefit from bug fixes and performance improvements. You can update dependencies using:
  ```bash
  bun upgrade
  ```
- **Code Quality:** Maintain code quality by adhering to coding standards and using linters/formatters.
- **Error Handling:** Implement robust error handling to gracefully handle potential issues.
- **Documentation:** Keep the README and other documentation up-to-date to reflect any changes or additions to the project.
