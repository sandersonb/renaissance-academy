/**
 * Tiny demo: build a population, run a seeded draw, print the legacy-format
 * trace (so it can be fed to new/analyze_lottery_results.py). Run: npm run lottery:demo
 */
import { RegStatus, Consideration } from '../regStatus.js';
import type { Child } from '../types.js';
import { runLottery, renderTrace } from './engine.js';

const kids: Child[] = [];
let id = 1;
const add = (parentId: number, grade: number, status: RegStatus, considerations = 0) =>
  kids.push({ childId: id++, parentId, grade, regStatus: status, considerations, position: null });

for (let i = 0; i < 6; i++) add(1000 + i, 0, RegStatus.ACPT_REENROLL);
for (let i = 0; i < 20; i++) add(2000 + i, 0, RegStatus.INITIAL, i < 4 ? Consideration.SIBLING : 0);
add(3000, 1, RegStatus.INITIAL);
add(3001, 1, RegStatus.INITIAL);
for (let i = 0; i < 10; i++) add(4000 + i, 2, RegStatus.INITIAL);
add(5000, 0, RegStatus.INITIAL);
add(5000, 2, RegStatus.INITIAL);
add(5000, 1, RegStatus.INITIAL);

const result = runLottery(kids, [10, 5, 6, 0, 0, 0, 0, 0, 0, 0], process.argv[2]);
process.stderr.write(`seed: ${result.seed}\n`);
process.stdout.write(renderTrace(result));
