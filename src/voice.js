import dotenv from 'dotenv';
import fs from "fs";
import path from "path";
import axios from "axios";
import * as url from 'url';
const __dirname = url.fileURLToPath(new URL('.', import.meta.url));

dotenv.config();

async function transcribe(file) {
    const response = await axios.post(
        'https://api.openai.com/v1/audio/transcriptions',
        {
            file,
            model: 'whisper-1'
        },
        {
            headers: {
                'Content-Type': 'multipart/form-data',
                Authorization: `Bearer ${process.env.OPENAI_API_KEY}`
            }
        }
    );

    return response.data.text;
}

async function main() {
    const file = fs.createReadStream(path.join(__dirname, "audio.ogg"));
    const transcript = await transcribe(file);

    // Save the text to a file
    fs.writeFileSync(path.join(__dirname, "transcription.txt"), transcript);
}

main().catch(console.error);
