// csvExport.ts — pure CSV builder + browser download helper.

// Quote a field if it contains a comma, quote, or newline; double inner quotes.
function quoteField(field: string): string {
    if (/[",\n]/.test(field)) {
        return `"${field.replace(/"/g, '""')}"`;
    }
    return field;
}

// buildCsv: header + rows -> CRLF-joined CSV text (no trailing line break).
export function buildCsv(header: string[], rowsText: string[][]): string {
    return [header, ...rowsText]
        .map(row => row.map(quoteField).join(','))
        .join('\r\n');
}

const BOM = String.fromCharCode(0xFEFF);

// downloadCsv: trigger a browser download of csv as a UTF-8 (BOM-prefixed) file.
export function downloadCsv(filename: string, csv: string): void {
    const blob = new Blob([BOM + csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}
