export function decodeBuffer(buffer) {
  const headerBytes = new DataView(buffer).getUint32(0, true);
  const header = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, 4, headerBytes)));
  const attributes = {};
  let cursor = 4 + headerBytes;
  const storage = {Float32Array, Uint32Array, Uint16Array, Int16Array, Uint8Array, Int8Array, Int32Array};
  for (const spec of header.attributes) {
    const Ctor = storage[spec.storageType];
    if (!Ctor) throw new Error(`Unsupported attribute storage: ${spec.storageType}`);
    const count = spec.id === 'indices' ? header.indexCount : header.vertexCount;
    const length = count * spec.componentSize, bytes = length * Ctor.BYTES_PER_ELEMENT;
    let array = new Ctor(buffer.slice(cursor, cursor + bytes));
    cursor += bytes;
    if (spec.needsPack) {
      const unpacked = new Float32Array(length), range = 2 ** (Ctor.BYTES_PER_ELEMENT * 8);
      const offset = spec.storageType.startsWith('Int') ? range / 2 : 0;
      for (let i = 0; i < length; i++) {
        const pack = spec.packedComponents[i % spec.componentSize];
        unpacked[i] = ((array[i] + offset) / range) * pack.delta + pack.from;
      }
      array = unpacked;
    }
    attributes[spec.id] = {array, size: spec.componentSize, count};
  }
  return {attributes, count: header.vertexCount};
}
export async function loadBuffer(path) {
  const response = await fetch(`/assets/${path}`);
  if (!response.ok) throw new Error(`Could not load landscape (${response.status}).`);
  return decodeBuffer(await response.arrayBuffer());
}
export const landscapeModels = [
  {id:'mountains',scene:0,model:'models/scene1/SC_01_BACKGROUND_MOUNTAINS.buf',texture:'textures/scene1/SC_01_BACKGROUND_MOUNTAINS_TEXTURE.webp',alpha:true},
  {id:'ridge',scene:0,model:'models/scene1/SC_01_MOUNTAIN_RIDGE.buf',texture:'textures/scene1/SC_01_RIDGE_TEXTURE.webp'},
  ...Array.from({length:6},(_,i)=>({id:`river-${i}`,scene:1,tile:i,model:`models/scene2/SC_02_PIECE_${i+1}.buf`,texture:`textures/scene2/SC_02_P${i+1}_TEXTURE.webp`})),
  {id:'lake-water',scene:2,water:true,model:'models/scene3/SC_03_WATER.buf',texture:'textures/scene3/SC_03_LAKE_TEXTURE.webp'},
  {id:'lake-land',scene:2,model:'models/scene3/SC_03_LAND.buf',texture:'textures/scene3/SC_03_LAKE_TEXTURE.webp'},
  {id:'hero',scene:0,shared:true,model:'models/scene1/SC_01_MOUNTAIN.buf',texture:'textures/scene1/SC_01_MOUNTAIN_TEXTURE.webp'}
];
