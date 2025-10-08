import fs from 'fs';
import csv from 'csv-parser';

interface Contact {
  name: string;
  phone: string;
  [key: string]: string;
}

export function parseCSV(filePath: string): Promise<Contact[]> {
  return new Promise((resolve, reject) => {
    const results: Contact[] = [];

    fs.createReadStream(filePath, { encoding: 'utf8' })
      .pipe(csv())
      .on('data', (data) => {
        // Normalize the data - look for common column names
        const contact: Contact = {
          name: data.name || data.Name || data.NAME || '',
          phone: data.phone || data.Phone || data.PHONE || data.number || data.Number || '',
          ...data // Include all other fields for personalization
        };

        if (contact.phone) {
          results.push(contact);
        }
      })
      .on('end', () => {
        resolve(results);
      })
      .on('error', (error) => {
        reject(error);
      });
  });
}
