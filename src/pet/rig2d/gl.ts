import { Rig2dError, RIG2D_STATES, type Rig2dState, type Affine } from './config';
import type { LoadedRig2dPersona } from './assets';
import { vertexShader, fragmentShader } from './shaders';

export class Rig2dGl {
  private readonly gl: WebGLRenderingContext;
  private program: WebGLProgram | null = null;
  private readonly buffers: WebGLBuffer[] = [];
  private readonly textures = new Map<string, WebGLTexture>();
  private readonly uniforms = new Map<string, WebGLUniformLocation | null>();
  private indexCount = 0;
  constructor(readonly canvas: HTMLCanvasElement, private readonly data: LoadedRig2dPersona) {
    const gl = canvas.getContext('webgl', { alpha: true, antialias: true, premultipliedAlpha: false });
    if (!gl) throw new Rig2dError('WebGL unavailable');
    this.gl = gl;
    try { this.initialize(); } catch (error) { this.destroy(); throw error; }
  }
  private compile(type: number, source: string): WebGLShader {
    const gl = this.gl, shader = gl.createShader(type);
    if (!shader) throw new Rig2dError('shader allocation failed');
    gl.shaderSource(shader, source); gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const detail = gl.getShaderInfoLog(shader); gl.deleteShader(shader); throw new Rig2dError(detail ?? 'shader compilation failed');
    }
    return shader;
  }
  private initialize(): void {
    const gl = this.gl, program = gl.createProgram();
    if (!program) throw new Rig2dError('program allocation failed');
    this.program = program;
    const vertex = this.compile(gl.VERTEX_SHADER, vertexShader);
    try {
      const fragment = this.compile(gl.FRAGMENT_SHADER, fragmentShader);
      try { gl.attachShader(program, vertex); gl.attachShader(program, fragment); gl.linkProgram(program); }
      finally { gl.deleteShader(fragment); }
    } finally { gl.deleteShader(vertex); }
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Rig2dError(gl.getProgramInfoLog(program) ?? 'link failed');
    gl.useProgram(program);
    for (const key of ['time','amount','mode','neck','blinkMap','mouthMap','eyes','mouth','eyeRadius','eyeAngle','blink','open','opacity']) this.uniforms.set(key, gl.getUniformLocation(program, `u_${key}`));
    const n = 64, points: number[] = [], indices: number[] = [];
    for (let y = 0; y <= n; y++) for (let x = 0; x <= n; x++) points.push(x * 512 / n, y * 512 / n);
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) { const i = y * (n + 1) + x; indices.push(i, i+1, i+n+1, i+1, i+n+2, i+n+1); }
    this.indexCount = indices.length;
    const vertices = gl.createBuffer(); if (!vertices) throw new Rig2dError('buffer allocation failed'); this.buffers.push(vertices);
    const elements = gl.createBuffer(); if (!elements) throw new Rig2dError('buffer allocation failed'); this.buffers.push(elements);
    gl.bindBuffer(gl.ARRAY_BUFFER, vertices); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(points), gl.STATIC_DRAW);
    const location = gl.getAttribLocation(program, 'a_pos'); gl.enableVertexAttribArray(location); gl.vertexAttribPointer(location, 2, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, elements); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(indices), gl.STATIC_DRAW);
    for (const [file, image] of this.data.images) {
      const texture = gl.createTexture(); if (!texture) throw new Rig2dError('texture allocation failed'); this.textures.set(file, texture);
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
    }
    ['base','blinkTexture','closedMouth'].forEach((key, i) => gl.uniform1i(gl.getUniformLocation(program, `u_${key}`), i));
    if (gl.getError() !== gl.NO_ERROR) throw new Rig2dError('WebGL asset initialization failed');
  }
  private uniform(key: string): WebGLUniformLocation | null { return this.uniforms.get(key) ?? null; }
  draw(state: Rig2dState, time: number, pixels: number): void {
    const gl = this.gl, pose = this.data.config.states[state], r = pose.rig;
    if (this.canvas.width !== pixels) this.canvas.width = this.canvas.height = pixels;
    gl.viewport(0, 0, pixels, pixels); gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
    for (let i = 0; i < 3; i++) {
      const file = pose.textures[i] ?? pose.textures[0]; const texture = file === undefined ? undefined : this.textures.get(file);
      if (!texture) throw new Rig2dError('required texture missing');
      gl.activeTexture(gl.TEXTURE0+i); gl.bindTexture(gl.TEXTURE_2D, texture);
    }
    const matrix = (a: Affine) => new Float32Array([a[0][0],a[1][0],0,a[0][1],a[1][1],0,a[0][2],a[1][2],1]);
    gl.uniformMatrix3fv(this.uniform('blinkMap'), false, matrix(pose.alignment.blink)); gl.uniformMatrix3fv(this.uniform('mouthMap'), false, matrix(pose.alignment.mouth));
    gl.uniform2fv(this.uniform('neck'), [...r.neck]); gl.uniform4fv(this.uniform('eyes'), [...r.eyes]); gl.uniform4fv(this.uniform('mouth'), [...r.mouth]);
    gl.uniform2fv(this.uniform('eyeRadius'), [...r.eyeRadius]); gl.uniform1f(this.uniform('eyeAngle'), r.eyeAngle); gl.uniform1f(this.uniform('mode'), RIG2D_STATES.indexOf(state));
    const phase = (time + (state === 'working' ? .7 : 0)) % 4.6;
    let blink = phase > 4.32 ? Math.sin((phase-4.32)/.28*Math.PI) ** 2 : 0;
    if (state === 'talking' && time % 5.8 > 5.4) blink = Math.max(blink, Math.sin((time % 5.8-5.4)/.4*Math.PI) ** 2);
    gl.uniform1f(this.uniform('time'), time); gl.uniform1f(this.uniform('amount'), 1); gl.uniform1f(this.uniform('blink'), blink);
    gl.uniform1f(this.uniform('open'), .12+.88*Math.abs(Math.sin(time*6.8)) ** .8); gl.uniform1f(this.uniform('opacity'), 1);
    gl.drawElements(gl.TRIANGLES, this.indexCount, gl.UNSIGNED_SHORT, 0);
  }
  destroy(): void {
    for (const texture of this.textures.values()) this.gl.deleteTexture(texture); this.textures.clear();
    for (const buffer of this.buffers) this.gl.deleteBuffer(buffer); this.buffers.length = 0;
    if (this.program) this.gl.deleteProgram(this.program); this.program = null;
  }
}
