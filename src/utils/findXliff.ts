import path from "path";
import fs from "fs";
import os from "os";
// @ts-ignore
import { xliff12ToJs } from "xliff";

export default async function findXliff(
  filepath: string
): Promise<[string, any][]> {
  const files = recursiveFindXliff(filepath);
  return await Promise.all(
    files.map(async filename => {
      const fileContent = fs.readFileSync(filename, "utf8").toString();
      const xcliff = await xliff12ToJs(fileContent);
      return [filename, xcliff];
    })
  );
}

export function recursiveFindXliff(filepath: string): string[] {
  const readablePath = path.resolve(
    filepath.replace("~", os.homedir()).replace(/\\ /g, " ")
  );
  const isDir = fs.lstatSync(readablePath).isDirectory();
  if (isDir) {
    const files = fs.readdirSync(readablePath);
    return files.flatMap(file =>
      recursiveFindXliff(path.join(readablePath, file))
    );
  }
  return filepath.endsWith(".xliff") ? [readablePath] : [];
}
