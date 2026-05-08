const fs = require('fs');
const content = fs.readFileSync('Index.html', 'utf8');
const scriptMatch = content.match(/<script>([\s\S]*?)<\/script>/);
if (scriptMatch) {
    const code = scriptMatch[1];
    try {
        new Function(code);
        console.log('Syntax OK');
    } catch (e) {
        console.error('Syntax Error:', e.message);
        // Find line number
        const lines = code.split('\n');
        // This is a rough estimate
        console.error('Check around lines in Index.html script block');
    }
}
