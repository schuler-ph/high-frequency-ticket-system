const version = process.version;
const nodeOptions = process.env.NODE_OPTIONS ?? "<unset>";
const ci = process.env.CI ?? "<unset>";

console.log(`[debug:runtime] node=${version}`);
console.log(`[debug:runtime] CI=${ci}`);
console.log(`[debug:runtime] NODE_OPTIONS=${nodeOptions}`);
