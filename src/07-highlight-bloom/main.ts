import SceneView from '@arcgis/core/views/SceneView';
import WebScene from '@arcgis/core/WebScene';
import { subclass } from "@arcgis/core/core/accessorSupport/decorators";
import RenderNode from "@arcgis/core/views/3d/webgl/RenderNode";
import ManagedFBO from "@arcgis/core/views/3d/webgl/ManagedFBO";
import Color from '@arcgis/core/Color';
import { createProgram } from '../utils';
import Daylight from '@arcgis/core/widgets/Daylight';
const view = new SceneView({
    container: "viewDiv",
    map: new WebScene({
        portalItem: {
            id: "9beec9328ca24cd0ae38b3657471d329"
        }
    }),

    viewingMode: "global",

    qualityProfile: "high",
    highlightOptions: {
        color: new Color([255, 255, 255]),
        fillOpacity: 0,
        haloOpacity: 0
    },

    environment: {
        atmosphere: {
            quality: "high"
        },

        lighting: {
            directShadowsEnabled: true
        }
    },
});

const daylight = new Daylight({
    view
});

view.ui.add(daylight, "bottom-right");

@subclass("esri.views.3d.HighlightBloomPass")
class HighlightBloomPass extends RenderNode {
    consumes: __esri.ConsumedNodes = { required: ["composite-color", "highlights"] };
    produces: __esri.RenderNodeOutput = "composite-color";

    vao: WebGLVertexArrayObject;
    positionBuffer: WebGLBuffer;
    positionLocation: number;
    program: WebGLProgram;
    colorTextureUniformLocation: WebGLUniformLocation;
    highlightTextureUniformLocation: WebGLUniformLocation;

    override render(inputs: ManagedFBO[]): ManagedFBO {
        const highlightInput = inputs.find((input) => input.name === "highlights");
        const highlight = highlightInput.getTexture();

        const colorInput = inputs.find((input) => input.name === "composite-color");
        const color = colorInput.getTexture();
        const output = this.acquireOutputFramebuffer();

        const gl = this.gl;

        if (!this.program) {
            this.initShaders(gl);
        }
        if (!this.vao) {
            this.initializeScreenSpacePass(gl);
        }
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
        gl.useProgram(this.program);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, color.glName);
        gl.uniform1i(this.colorTextureUniformLocation, 0);

        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, highlight.glName);
        gl.uniform1i(this.highlightTextureUniformLocation, 1);

        // Issue the render call for a screen space render pass
        gl.bindVertexArray(this.vao);
        gl.drawArrays(gl.TRIANGLES, 0, 3);

        output.attachDepth(colorInput.getAttachment(gl.DEPTH_STENCIL_ATTACHMENT));
        return output;
    }

    initShaders(gl: WebGL2RenderingContext) {
        // Initialize shaders
        const vsSource = `#version 300 es
        in vec2 position;
        out vec2 uv;

        void main() {
            gl_Position = vec4(position, 0.0, 1.0);
            uv = position * 0.5 + vec2(0.5);
        }`;

        const fsSource = `#version 300 es
        precision highp float;
        out lowp vec4 fragColor;
        in vec2 uv;
        uniform sampler2D colorTex;
        uniform sampler2D highlightTex;
        const float blurRadius = 30.0;
        void main() {
            vec4 color = texture(colorTex, uv);    
            ivec2 texSize = textureSize(highlightTex, 0);
            vec3 blurSum = vec3(0.0);
            for (float i = -blurRadius; i <= blurRadius; i += 1.0)
            {
                for (float j = -blurRadius; j <= blurRadius; j += 1.0)
                {
                    vec2 offset = vec2(i, j) / vec2(texSize);
                    blurSum += texture(highlightTex, uv + offset).rgb;
                }
            }
            fragColor = vec4(blurSum/pow(blurRadius, 2.0), 0.2) + color;
        }`;

        // Setup GLSL program
        this.program = createProgram(gl, vsSource, fsSource);
        if (!this.program) {
            alert("Could not initialize shaders");
        }
        this.colorTextureUniformLocation = gl.getUniformLocation(this.program, "colorTex");
        this.highlightTextureUniformLocation = gl.getUniformLocation(this.program, "highlightTex");
        this.positionLocation = gl.getAttribLocation(this.program, "position");
    }

    initializeScreenSpacePass(gl: WebGL2RenderingContext) {
        this.vao = gl.createVertexArray();
        gl.bindVertexArray(this.vao);
        this.positionBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, this.positionBuffer);
        const vertices = new Float32Array([-1.0, -1.0, 3.0, -1.0, -1.0, 3.0]);
        gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);

        gl.vertexAttribPointer(this.positionLocation, 2, gl.FLOAT, false, 0, 0);
        gl.enableVertexAttribArray(this.positionLocation);

        gl.bindVertexArray(null);
    }
}

new HighlightBloomPass({ view });
