import * as fs from "fs/promises";
import { Buffer } from "node:buffer";
import { join } from "path";

export const writeFile = async (
  filename: string,
  data: string
): Promise<void> => {
  try {
    const content = Buffer.from(data, "utf8");
    const filePath = join(process.cwd(), "gen", filename);
    await fs.writeFile(filePath, content, "utf8");
    console.info(`File create: ${filePath}`);
  } catch (e) {
    console.error(e);
    throw new Error(`Failed to create ${filename}`);
  }
};
