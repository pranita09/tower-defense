import { SPRITE_UVS } from './atlas';
import { unpackBlue, unpackGreen, unpackRed } from '../data/palette';

/**
 * Every sprite is 13 floats appended to one array, uploaded once per frame and
 * drawn with a single `drawArraysInstanced`. So the per-sprite CPU cost is a few
 * array writes, and the draw call count stops depending on the entity count.
 */

/** x, y, halfWidth, halfHeight, rotation, u0, v0, u1, v1, r, g, b, a */
const FLOATS_PER_SPRITE = 13;
const BYTES_PER_SPRITE = FLOATS_PER_SPRITE * 4;

const VERTEX_SHADER = `#version 300 es
layout(location = 0) in vec2 aCorner;
layout(location = 1) in vec4 aPosSize;
layout(location = 2) in float aRotation;
layout(location = 3) in vec4 aUv;
layout(location = 4) in vec4 aColor;

uniform vec2 uScale;
uniform vec2 uOffset;

out vec2 vUv;
out vec4 vColor;

void main() {
  vec2 corner = aCorner * aPosSize.zw;
  float c = cos(aRotation);
  float s = sin(aRotation);
  vec2 rotated = vec2(corner.x * c - corner.y * s, corner.x * s + corner.y * c);
  vec2 world = aPosSize.xy + rotated;
  gl_Position = vec4(world * uScale + uOffset, 0.0, 1.0);
  vUv = mix(aUv.xy, aUv.zw, aCorner + 0.5);
  vColor = aColor;
}`;

const FRAGMENT_SHADER = `#version 300 es
precision mediump float;

in vec2 vUv;
in vec4 vColor;

uniform sampler2D uAtlas;

out vec4 outColor;

void main() {
  outColor = texture(uAtlas, vUv) * vColor;
}`;

function compile(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) throw new Error('Could not create shader.');
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(`Shader failed to compile: ${log ?? 'unknown error'}`);
  }
  return shader;
}

export class SpriteBatch {
  readonly capacity: number;
  /** Sprites appended since the last flush. */
  count = 0;
  /** Sprites rejected for falling outside the visible area. */
  culled = 0;

  private readonly gl: WebGL2RenderingContext;
  private readonly data: Float32Array;
  private readonly program: WebGLProgram;
  private readonly vao: WebGLVertexArrayObject;
  private readonly instanceBuffer: WebGLBuffer;
  private readonly cornerBuffer: WebGLBuffer;
  private readonly texture: WebGLTexture;
  private readonly scaleLocation: WebGLUniformLocation | null;
  private readonly offsetLocation: WebGLUniformLocation | null;

  private cursor = 0;
  private cullMinX = -Infinity;
  private cullMinY = -Infinity;
  private cullMaxX = Infinity;
  private cullMaxY = Infinity;

  constructor(gl: WebGL2RenderingContext, atlas: TexImageSource, capacity: number) {
    this.gl = gl;
    this.capacity = capacity;
    this.data = new Float32Array(capacity * FLOATS_PER_SPRITE);

    const vertex = compile(gl, gl.VERTEX_SHADER, VERTEX_SHADER);
    const fragment = compile(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER);
    const program = gl.createProgram();
    if (!program) throw new Error('Could not create the sprite program.');
    gl.attachShader(program, vertex);
    gl.attachShader(program, fragment);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error(`Sprite program failed to link: ${gl.getProgramInfoLog(program) ?? ''}`);
    }
    gl.deleteShader(vertex);
    gl.deleteShader(fragment);
    this.program = program;

    this.scaleLocation = gl.getUniformLocation(program, 'uScale');
    this.offsetLocation = gl.getUniformLocation(program, 'uOffset');

    const vao = gl.createVertexArray();
    if (!vao) throw new Error('Could not create a vertex array object.');
    this.vao = vao;
    gl.bindVertexArray(vao);

    // Static unit quad, shared by every instance.
    const corners = new Float32Array([
      -0.5, -0.5, 0.5, -0.5, 0.5, 0.5, -0.5, -0.5, 0.5, 0.5, -0.5, 0.5,
    ]);
    const cornerBuffer = gl.createBuffer();
    if (!cornerBuffer) throw new Error('Could not create the quad buffer.');
    this.cornerBuffer = cornerBuffer;
    gl.bindBuffer(gl.ARRAY_BUFFER, cornerBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, corners, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 8, 0);

    const instanceBuffer = gl.createBuffer();
    if (!instanceBuffer) throw new Error('Could not create the instance buffer.');
    this.instanceBuffer = instanceBuffer;
    gl.bindBuffer(gl.ARRAY_BUFFER, instanceBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, this.data.byteLength, gl.DYNAMIC_DRAW);

    const layout: Array<[location: number, size: number, offset: number]> = [
      [1, 4, 0],
      [2, 1, 16],
      [3, 4, 20],
      [4, 4, 36],
    ];
    for (const [location, size, offset] of layout) {
      gl.enableVertexAttribArray(location);
      gl.vertexAttribPointer(location, size, gl.FLOAT, false, BYTES_PER_SPRITE, offset);
      gl.vertexAttribDivisor(location, 1);
    }

    gl.bindVertexArray(null);

    const texture = gl.createTexture();
    if (!texture) throw new Error('Could not create the atlas texture.');
    this.texture = texture;
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, atlas);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  }

  /** Anything outside this is dropped before it reaches the buffer. */
  setCullBounds(minX: number, minY: number, maxX: number, maxY: number): void {
    this.cullMinX = minX;
    this.cullMinY = minY;
    this.cullMaxX = maxX;
    this.cullMaxY = maxY;
  }

  begin(): void {
    this.cursor = 0;
    this.count = 0;
    this.culled = 0;
  }

  push(
    spriteId: number,
    x: number,
    y: number,
    halfWidth: number,
    halfHeight: number,
    rotation: number,
    color: number,
    alpha: number
  ): void {
    const reach = halfWidth > halfHeight ? halfWidth : halfHeight;
    if (
      x + reach < this.cullMinX ||
      x - reach > this.cullMaxX ||
      y + reach < this.cullMinY ||
      y - reach > this.cullMaxY
    ) {
      this.culled += 1;
      return;
    }
    if (this.count >= this.capacity) return;

    const data = this.data;
    let i = this.cursor;
    const uv = spriteId * 4;

    data[i] = x;
    data[i + 1] = y;
    data[i + 2] = halfWidth * 2;
    data[i + 3] = halfHeight * 2;
    data[i + 4] = rotation;
    data[i + 5] = SPRITE_UVS[uv];
    data[i + 6] = SPRITE_UVS[uv + 1];
    data[i + 7] = SPRITE_UVS[uv + 2];
    data[i + 8] = SPRITE_UVS[uv + 3];
    data[i + 9] = unpackRed(color);
    data[i + 10] = unpackGreen(color);
    data[i + 11] = unpackBlue(color);
    data[i + 12] = alpha;

    i += FLOATS_PER_SPRITE;
    this.cursor = i;
    this.count += 1;
  }

  /** `scale`/`offset` map world coordinates into clip space. */
  flush(scaleX: number, scaleY: number, offsetX: number, offsetY: number): void {
    if (this.count === 0) return;
    const gl = this.gl;

    gl.useProgram(this.program);
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceBuffer);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.data, 0, this.cursor);

    gl.uniform2f(this.scaleLocation, scaleX, scaleY);
    gl.uniform2f(this.offsetLocation, offsetX, offsetY);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.texture);

    gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, this.count);
    gl.bindVertexArray(null);
  }

  dispose(): void {
    const gl = this.gl;
    gl.deleteProgram(this.program);
    gl.deleteVertexArray(this.vao);
    gl.deleteBuffer(this.instanceBuffer);
    gl.deleteBuffer(this.cornerBuffer);
    gl.deleteTexture(this.texture);
  }
}
