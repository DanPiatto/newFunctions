import * as express from 'express';
import * as cors from "cors";
import * as functions from "firebase-functions";
import { filesUpload } from './fileuploadMiddleware';
import OpenAI from "openai";
import * as fs from "fs";
import axios from "axios";
import { OPENAI_API_KEY, PDF_RENDERER_URL } from "./config";

let openaiClient: OpenAI | null = null;
function getOpenAI(): OpenAI {
  if (!openaiClient) {
    openaiClient = new OpenAI({ apiKey: OPENAI_API_KEY.value() });
  }
  return openaiClient;
}

const app = express();
app.use(cors({ origin: true }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Ask ChatGPT to extract text from image
async function askChatGPT(imageBase64: string, model: string) {
  const completion = await getOpenAI().chat.completions.create({
    messages: [
      { role: 'system', content: 'You are a helpful assistant that responds in Markdown. Help me extract text from this image and return the data in a structured JSON format suitable for creating a table.' },
      {
        role: 'user', content: [
          { type: 'text', text: 'I am giving you one or multiple images of a menu card of a restaurant. I want you to extract the text from the image and present it in a structured JSON format. One image can contain multiple sections of a menu with different details as well. I am interested in the following information; Name of venue, name of the menu, availability, name of dishes/items on menu, description of dish/item, necessary choices, optional extras, standard features, available options (GF, GFO, VEG, V, etc), price. This is the information I need extracted and should be returned in the response as venue, avail, menu_name, items, description, necessary_choices, extras, standard_features, options, price. I want to make a table of the extracted data in an excel file using your JSON response.' },
          { type: 'image_url', image_url: { url: `data:image/png;base64,${imageBase64}` } }
        ]
      }
    ],
    model,
  });

  return completion.choices[0].message.content;
}

app.post('/uploadFile', filesUpload, async (req: any, res: any) => {
  const file = req.files[0];
  const model = 'gpt-4o';

  if (!file) {
    return res.status(400).send('No file uploaded.');
  }

  try {
    let jsonDataArray: any[] = [];

    const { mimetype, buffer } = file;

    const allowedImages = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
    if (mimetype === 'application/pdf') {
      // Call Cloud Run PDF renderer
      const rendererUrl = PDF_RENDERER_URL.value();
      if (!rendererUrl) {
        return res.status(500).send('PDF renderer not configured. Set PDF_RENDERER_URL param.');
      }
      const payload = {
        pdf_base64: buffer.toString('base64'),
        dpi: 200,
        format: 'png',
        max_pages: 10,
      };
      const response = await axios.post(`${rendererUrl.replace(/\/$/, '')}/render`, payload, { timeout: 120000 });
      const images: string[] = response.data?.images || [];
      for (const img64 of images) {
        const jsonData = await askChatGPT(img64, model);
        jsonDataArray.push(jsonData);
      }
    } else if (allowedImages.includes(mimetype)) {
      const base64Data = buffer.toString('base64');
      const jsonData = await askChatGPT(base64Data, model);
      jsonDataArray.push(jsonData);
    } else {
      return res.status(415).send('Unsupported file type. Please upload an image (PNG, JPEG, GIF, WEBP) or a PDF.');
    }

    res.json({ jsonDataArray });

  } catch (error) {
    res.status(500).send('An error occurred during file processing.');
  } finally {
    // Cleanup uploaded files if present (middleware may already have removed it)
    try {
      if (file?.path && fs.existsSync(file.path)) {
        fs.unlinkSync(file.path);
      }
    } catch (e) {
      // ignore
    }
  }
});

export const computervision = functions
  .region("australia-southeast1")
  .runWith({ secrets: [OPENAI_API_KEY] })
  .https.onRequest(app);

