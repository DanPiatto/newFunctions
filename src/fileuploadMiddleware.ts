import busboy = require('busboy');// Import Busboy typings if available
import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';
import { Request, Response, NextFunction } from 'express';

export const filesUpload = function (req: Request, res: Response, next: NextFunction) {
  const busboys = busboy({ headers: req.headers })

  const fields: any = {}; // Assuming fields can be any type
  const files: any[] = []; // Assuming files can be any type
  const fileWrites: Promise<void>[] = [];
  const tmpdir = os.tmpdir();

  busboys.on("field", (key: string, value: any) => {
    fields[key] = value; // Store fields
  });

  busboys.on("file", (fieldname: string, file: NodeJS.ReadableStream, filename: any, encoding: string, mimetype: string) => {
    const filepath = path.join(tmpdir, filename.filename);
    console.log(`Handling file upload field ${fieldname}: ${filename.filename} (${filepath})`);
    const writeStream = fs.createWriteStream(filepath);
    file.pipe(writeStream);

    fileWrites.push(
      new Promise<void>((resolve, reject) => {
        file.on("end", () => writeStream.end());
        writeStream.on("finish", () => {
          fs.readFile(filepath, (err, buffer) => {
            const size = Buffer.byteLength(buffer);
     
            if (err) {
              return reject(err);
            }

            files.push({
              fieldname,
              originalname: filename.filename,
              encoding: filename.encoding,
              mimetype: filename.mimeType,
              buffer,
              size,
              path: filepath
            });

            try {
              fs.unlinkSync(filepath); // Remove file from temp directory
            } catch (error) {
              return reject(error);
            }

            resolve();
          });
        });
        writeStream.on("error", reject);
      })
    );
  });

  busboys.on("finish", () => {
    Promise.all(fileWrites)
      .then(() => {
        req.body = fields;
        req.files = files;
        next();
      })
      .catch(next);
  });

  if (req.body) {
    busboys.end(req.body);
  } else {
    // Otherwise, end the busboy stream with the request itself
    req.pipe(busboys);
  }
  // End busboy with the raw request body
};
