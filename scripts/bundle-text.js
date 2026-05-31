const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.resolve(__dirname, '..');
const OUTPUT_FILE = path.join(ROOT_DIR, 'all-files.min.txt');
const SKIP_DIRS = new Set(['node_modules', '.git', '.vscode', 'dist', 'build', 'coverage', 'logs', 'tmp']);
const BINARY_EXTENSIONS = new Set([
    '.png', '.jpg', '.jpeg', '.gif', '.svg', '.ico', '.webp',
    '.mp3', '.mp4', '.wav', '.ogg', '.avi',
    '.woff', '.woff2', '.ttf', '.eot',
    '.zip', '.tar', '.gz', '.7z', '.exe', '.dll'
]);

async function main() {
    const chunks = [];
    const files = await collectFiles(ROOT_DIR);

    for (const filePath of files) {
        const relPath = path.relative(ROOT_DIR, filePath);
        const content = await fs.promises.readFile(filePath, 'utf8');
        const minified = minifyContent(content);
        if (minified) {
            chunks.push(`/* ${relPath} */ ${minified}`);
        }
    }

    const output = chunks.join(' ');
    await fs.promises.writeFile(OUTPUT_FILE, output, 'utf8');
    console.log(`Combined ${chunks.length} files into ${OUTPUT_FILE}`);
}

async function collectFiles(dir) {
    const entries = await fs.promises.readdir(dir, { withFileTypes: true });
    const files = [];

    for (const entry of entries) {
        if (SKIP_DIRS.has(entry.name)) {
            continue;
        }

        const fullPath = path.join(dir, entry.name);

        if (entry.isDirectory()) {
            files.push(...await collectFiles(fullPath));
        } else if (entry.isFile() && !isBinary(fullPath)) {
            files.push(fullPath);
        }
    }

    return files;
}

function isBinary(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    return BINARY_EXTENSIONS.has(ext);
}

function minifyContent(content) {
    return content.replace(/\s+/g, ' ').trim();
}

main().catch((error) => {
    console.error('Bundle script failed:', error);
    process.exitCode = 1;
});
