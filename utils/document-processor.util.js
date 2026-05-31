// Document ingestion/analysis helper that normalizes PDFs, Office docs, spreadsheets, and text for AI workflows.
const pdfParse = require('pdf-parse');
const XLSX = require('xlsx');
const mammoth = require('mammoth');
const axios = require('axios');

class DocumentProcessor {
    constructor() {
        this.supportedFormats = {
            pdf: this.parsePDF.bind(this),
            xlsx: this.parseExcel.bind(this),
            xls: this.parseExcel.bind(this),
            docx: this.parseWord.bind(this),
            doc: this.parseWord.bind(this),
            txt: this.parseText.bind(this)
        };
    }

    async processFile(file, options = {}) {
        const extension = file.originalname.split('.').pop().toLowerCase();
        const processor = this.supportedFormats[extension];

        if (!processor) {
            throw new Error(`Unsupported file format: ${extension}`);
        }

        return await processor(file.buffer, file.originalname, options);
    }

    async processUrl(url, options = {}) {
        try {
            const response = await axios.get(url, {
                responseType: 'arraybuffer',
                timeout: 30000
            });

            const buffer = Buffer.from(response.data);
            const filename = url.split('/').pop() || 'document';

            return await this.processFile(
                { buffer, originalname: filename },
                options
            );
        } catch (error) {
            throw new Error(`Failed to download document: ${error.message}`);
        }
    }

    async parsePDF(buffer, filename, options) {
        try {
            const data = await pdfParse(buffer);

            const result = {
                filename,
                type: 'pdf',
                pageCount: data.numpages,
                text: options.extractText ? data.text : undefined,
                metadata: options.extractMetadata ? data.metadata : undefined
            };

            return result;
        } catch (error) {
            throw new Error(`PDF parsing failed: ${error.message}`);
        }
    }

    async parseExcel(buffer, filename, options) {
        try {
            const workbook = XLSX.read(buffer, { type: 'buffer' });
            const sheets = {};

            workbook.SheetNames.forEach(sheetName => {
                const worksheet = workbook.Sheets[sheetName];
                sheets[sheetName] = XLSX.utils.sheet_to_json(worksheet, { defval: '' });
            });

            return {
                filename,
                type: 'excel',
                sheetCount: workbook.SheetNames.length,
                sheetNames: workbook.SheetNames,
                data: sheets,
                metadata: options.extractMetadata ? {
                    created: workbook.Props?.CreatedDate,
                    modified: workbook.Props?.ModifiedDate,
                    author: workbook.Props?.Author
                } : undefined
            };
        } catch (error) {
            throw new Error(`Excel parsing failed: ${error.message}`);
        }
    }

    async parseWord(buffer, filename, options) {
        try {
            const result = await mammoth.extractRawText({ buffer });

            return {
                filename,
                type: 'word',
                text: options.extractText ? result.value : undefined,
                metadata: options.extractMetadata ? {
                    messages: result.messages
                } : undefined
            };
        } catch (error) {
            throw new Error(`Word document parsing failed: ${error.message}`);
        }
    }

    parseText(buffer, filename, options) {
        return {
            filename,
            type: 'text',
            text: options.extractText ? buffer.toString('utf8') : undefined,
            metadata: options.extractMetadata ? {
                size: buffer.length,
                encoding: 'utf8'
            } : undefined
        };
    }

    async analyzeDocument(file, analysisType = 'summary') {
        const processed = await this.processFile(file, { extractText: true });

        if (!processed.text) {
            throw new Error('No text content available for analysis');
        }

        // Use AI to analyze the document content
        const analysisPrompts = {
            summary: `Please provide a concise summary of the following document:\n\n${processed.text}`,
            keypoints: `Extract the key points from this document:\n\n${processed.text}`,
            sentiment: `Analyze the sentiment and tone of this document:\n\n${processed.text}`,
            structure: `Describe the structure and main sections of this document:\n\n${processed.text}`
        };

        const prompt = analysisPrompts[analysisType] || analysisPrompts.summary;

        // This would integrate with your existing AI routes
        return {
            analysisType,
            document: processed.filename,
            content: processed.text.substring(0, 1000) + '...', // Preview
            prompt
        };
    }
}

module.exports = DocumentProcessor;