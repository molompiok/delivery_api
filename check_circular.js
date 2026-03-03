const fs = require('fs');
const path = require('path');

const modelsDir = path.join(__dirname, 'app/models');
const files = fs.readdirSync(modelsDir).filter(f => f.endsWith('.ts'));

const deps = {};

for (const file of files) {
    const content = fs.readFileSync(path.join(modelsDir, file), 'utf-8');
    const imports = [];
    const regex = /import\s+(?!type)[^{}]*?\s+from\s+['"]#models\/([^'"]+)['"]/g;
    let match;
    while ((match = regex.exec(content)) !== null) {
        imports.push(match[1] + '.ts');
    }
    const destructuringRegex = /import\s+(?!type)\{[^}]+\}\s+from\s+['"]#models\/([^'"]+)['"]/g;
    while ((match = destructuringRegex.exec(content)) !== null) {
        imports.push(match[1] + '.ts');
    }
    deps[file] = imports;
}

function findCycles(node, visited, pathStack) {
    visited.add(node);
    pathStack.push(node);

    for (const neighbor of (deps[node] || [])) {
        if (!visited.has(neighbor)) {
            findCycles(neighbor, visited, pathStack);
        } else if (pathStack.includes(neighbor)) {
            const cycle = pathStack.slice(pathStack.indexOf(neighbor));
            console.log('Cycle found:', cycle.join(' -> ') + ' -> ' + neighbor);
        }
    }
    pathStack.pop();
}

const visited = new Set();
for (const node of Object.keys(deps)) {
    if (!visited.has(node)) {
        findCycles(node, visited, []);
    }
}
