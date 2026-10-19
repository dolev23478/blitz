import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { Injectable } from '@nestjs/common';
import type { IPostExporter, ProfileScrapeResult } from '../contracts/x-scraper.interfaces.js';

@Injectable()
export class JsonExporter implements IPostExporter {
  public async export(result: ProfileScrapeResult, outputDir: string): Promise<string> {
    const targetDir = outputDir || '.';
    await fs.mkdir(targetDir, { recursive: true });

    const rawHandle = result && result.handle ? result.handle : '';
    const cleanHandle = rawHandle.replace(/^@/, '').trim().replace(/[^a-zA-Z0-9_-]/g, '_') || 'profile';
    const fileName = `${cleanHandle}.json`;
    const filePath = path.join(targetDir, fileName);

    const jsonContent = JSON.stringify(result, null, 2);
    await fs.writeFile(filePath, jsonContent, 'utf-8');

    return filePath;
  }
}

export default JsonExporter;
