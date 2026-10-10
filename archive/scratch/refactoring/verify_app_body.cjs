const fs = require('fs');
const parser = require('../app/node_modules/@babel/parser');
const traverse = require('../app/node_modules/@babel/traverse').default;

const mainCode = fs.readFileSync('app/src/main.jsx', 'utf8');

const startMarker = 'const menu = [';
const endMarker = 'function formatConversationPreview(message, media = null)';

const startIdx = mainCode.indexOf(startMarker);
const endIdx = mainCode.indexOf(endMarker);
const appBlock = mainCode.slice(startIdx, endIdx).trim();

const appFileContent = 'import React, { useState, useRef, useEffect, useMemo, useCallback } from "react";\r\n' + appBlock;
const ast = parser.parse(appFileContent, { sourceType: 'module', plugins: ['jsx'] });

let states = 0, refs = 0, effects = 0;
traverse(ast, {
  CallExpression(p) {
    if (p.node.callee.name === 'useState') states++;
    if (p.node.callee.name === 'useRef') refs++;
    if (p.node.callee.name === 'useEffect') effects++;
  }
});

console.log('App.jsx states:', states);
console.log('App.jsx refs:', refs);
console.log('App.jsx effects:', effects);
