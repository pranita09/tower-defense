/**
 * The baked terrain texture, drawn as one quad. Costs a single draw call however
 * detailed the map is, instead of the few hundred fills the naive renderer repeats
 * every frame.
 */

const VERTEX_SHADER = `#version 300 es
layout(location = 0) in vec2 aCorner;

uniform vec2 uScale;
uniform vec2 uOffset;
uniform vec2 uWorldSize;

out vec2 vUv;

void main() {
  vec2 world = aCorner * uWorldSize;
  gl_Position = vec4(world * uScale + uOffset, 0.0, 1.0);
  vUv = aCorner;
}`;

const FRAGMENT_SHADER = `#version 300 es
precision mediump float;

in vec2 vUv;
uniform sampler2D uTexture;
out vec4 outColor;

void main() {
  outColor = texture(uTexture, vUv);
}`;

function compile(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) throw new Error('Could not create shader.');
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(`Background shader failed to compile: ${log ?? 'unknown error'}`);
  }
  return shader;
}

export class BackgroundQuad {
  private readonly gl: WebGL2RenderingContext;
  private readonly program: WebGLProgram;
  private readonly vao: WebGLVertexArrayObject;
  private readonly buffer: WebGLBuffer;
  private readonly texture: WebGLTexture;
  private readonly scaleLocation: WebGLUniformLocation | null;
  private readonly offsetLocation: WebGLUniformLocation | null;
  private readonly worldSizeLocation: WebGLUniformLocation | null;
  private readonly width: number;
  private readonly height: number;

  constructor(gl: WebGL2RenderingContext, source: TexImageSource, width: number, height: number) {
    this.gl = gl;
    this.width = width;
    this.height = height;

    const vertex = compile(gl, gl.VERTEX_SHADER, VERTEX_SHADER);
    const fragment = compile(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER);
    const program = gl.createProgram();
    if (!program) throw new Error('Could not create the background program.');
    gl.attachShader(program, vertex);
    gl.attachShader(program, fragment);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error(`Background program failed to link: ${gl.getProgramInfoLog(program) ?? ''}`);
    }
    gl.deleteShader(vertex);
    gl.deleteShader(fragment);
    this.program = program;

    this.scaleLocation = gl.getUniformLocation(program, 'uScale');
    this.offsetLocation = gl.getUniformLocation(program, 'uOffset');
    this.worldSizeLocation = gl.getUniformLocation(program, 'uWorldSize');

    const vao = gl.createVertexArray();
    if (!vao) throw new Error('Could not create the background vertex array.');
    this.vao = vao;
    gl.bindVertexArray(vao);

    const buffer = gl.createBuffer();
    if (!buffer) throw new Error('Could not create the background buffer.');
    this.buffer = buffer;
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1]),
      gl.STATIC_DRAW
    );
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 8, 0);
    gl.bindVertexArray(null);

    const texture = gl.createTexture();
    if (!texture) throw new Error('Could not create the background texture.');
    this.texture = texture;
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  }

  draw(scaleX: number, scaleY: number, offsetX: number, offsetY: number): void {
    const gl = this.gl;
    gl.useProgram(this.program);
    gl.bindVertexArray(this.vao);
    gl.uniform2f(this.scaleLocation, scaleX, scaleY);
    gl.uniform2f(this.offsetLocation, offsetX, offsetY);
    gl.uniform2f(this.worldSizeLocation, this.width, this.height);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    gl.bindVertexArray(null);
  }

  dispose(): void {
    const gl = this.gl;
    gl.deleteProgram(this.program);
    gl.deleteVertexArray(this.vao);
    gl.deleteBuffer(this.buffer);
    gl.deleteTexture(this.texture);
  }
}
