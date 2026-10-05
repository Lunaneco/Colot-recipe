import { beginStrokeDynamics, applyStamp } from "../lib/brushDynamics.ts";
import {
  createPigmentField, depositStamp, pigmentVectorFromRatio,
  compositePigmentLayers, unionBounds,
} from "../lib/pigmentField.ts";

// Fixed independent-audit workload: three placements and one actual dirty
// render per event, crossing a wet paint patch at the largest UI brush size.
const settings = {
  size: 140, opacity: 0.84, pressureSensitivity: 0.72, water: 0.28,
  bleed: 0.18, hardness: 0.64, spacing: 0.16,
};
const blue = pigmentVectorFromRatio({ blue: 1 });
const red = pigmentVectorFromRatio({ red: 1 });
const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const coloring = process.argv.includes("--coloring");
const emptyLayers = process.argv.includes("--empty-layers")
  ? [createPigmentField(1000, 700), createPigmentField(1000, 700)] : [];
const paper = { r: 255, g: 253, b: 248 };
let paperImage, inkImage;
if (coloring) {
  paperImage = { width: 1000, height: 700, data: new Uint8ClampedArray(1000 * 700 * 4) };
  inkImage = { width: 1000, height: 700, data: new Uint8ClampedArray(1000 * 700 * 4) };
  for (let index = 0; index < 1000 * 700; index += 1) {
    paperImage.data.set([255, 253, 248, 255], index * 4);
    if (index % 1000 % 60 < 2 || Math.floor(index / 1000) % 60 < 2) inkImage.data[index * 4 + 3] = 255;
  }
}

for (const tool of ["round", "watercolor", "blur", "mixer"]) {
  const field = createPigmentField(1000, 700);
  depositStamp(field, 450, 350, 180, { pigment: blue, mass: 0.8, wetness: 0.8, hardness: 0.9 });
  const brush = beginStrokeDynamics(tool, settings, { pigment: red, waterRatio: 0, opacity: 0.98 }, 2);
  const elapsed = [], applying = [], rendering = [];
  for (let event = 0; event < 15; event += 1) {
    const start = performance.now();
    let dirty = null;
    for (let j = 0; j < 3; j += 1) {
      const i = event * 3 + j;
      dirty = unionBounds(dirty, applyStamp(field, brush,
        { x: 250 + i * 9, y: 350, time: i * 12, pressure: 0.5 }, settings));
    }
    const beforeRender = performance.now();
    if (dirty) {
      const image = { width: dirty.width, height: dirty.height,
        data: new Uint8ClampedArray(dirty.width * dirty.height * 4) };
      const sources = [
        ...emptyLayers.map((empty) => ({ kind: "paint", field: empty })),
        { kind: "paint", field },
        ...(coloring ? [{ kind: "image", image: inkImage }] : []),
      ];
      compositePigmentLayers(coloring ? paperImage : paper, sources, image, dirty);
    }
    const end = performance.now();
    applying.push(beforeRender - start);
    rendering.push(end - beforeRender);
    elapsed.push(end - start);
  }
  console.log(JSON.stringify({ tool, events: 15, placements: 45,
    mode: coloring ? "coloring" : "drawing", emptyLayers: emptyLayers.length,
    medianMs: median(elapsed), maxMs: Math.max(...elapsed), coldMs: elapsed[0],
    medianApplyMs: median(applying), medianRenderMs: median(rendering) }));
}
