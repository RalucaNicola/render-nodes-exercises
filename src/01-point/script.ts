import WebScene from "@arcgis/core/WebScene";
import { subclass } from "@arcgis/core/core/accessorSupport/decorators";
import ManagedFBO from "@arcgis/core/views/3d/webgl/ManagedFBO";
import RenderNode from "@arcgis/core/views/3d/webgl/RenderNode";
import SceneView from "@arcgis/core/views/SceneView";
import { createProgram } from "../utils";
import * as webgl from "@arcgis/core/views/3d/webgl";
import SpatialReference from "@arcgis/core/geometry/SpatialReference";
import * as reactiveUtils from "@arcgis/core/core/reactiveUtils";

const view = new SceneView({
    container: "viewDiv",
    map: new WebScene({
        portalItem: {
            id: "9beec9328ca24cd0ae38b3657471d329"
        }
    }),

    qualityProfile: "high",
    viewingMode: "global",

    environment: {
        atmosphere: {
            quality: "high"
        },

        lighting: {
            directShadowsEnabled: true
        }
    },
});

const points = [{
    geometry: [8.5408558874, 47.3670509886, 415],
    color: [255, 0, 0, 255]
}];

@subclass("esr.views.3d.GeometryRenderNode")
class GeometryRenderNode extends RenderNode {
    consumes: __esri.ConsumedNodes = { required: ["opaque-color"] };
    produces: __esri.RenderNodeOutput = "opaque-color";

    program: WebGLProgram;

    attribPositionLocation: number;
    attribColorLocation: number;
    uniformProjectionMatrixLocation: WebGLUniformLocation;
    uniformModelViewMatrixLocation: WebGLUniformLocation;

    vboPositions: WebGLBuffer;
    vboColor: WebGLBuffer;

    initialize() {
        this.initShaders();
        this.initData();
    }

    override render(inputs: ManagedFBO[]): ManagedFBO {
        const output = this.bindRenderTarget();
        const gl = this.gl;
        gl.bindBuffer(gl.ARRAY_BUFFER, this.vboPositions);
        gl.enableVertexAttribArray(this.attribPositionLocation);
        gl.vertexAttribPointer(this.attribPositionLocation, 3, gl.FLOAT, false, 0, 0);

        gl.bindBuffer(gl.ARRAY_BUFFER, this.vboColor);
        gl.enableVertexAttribArray(this.attribColorLocation);
        gl.vertexAttribPointer(this.attribColorLocation, 4, gl.UNSIGNED_BYTE, true, 0, 0);

        gl.useProgram(this.program);

        gl.uniformMatrix4fv(
            this.uniformProjectionMatrixLocation,
            false,
            this.camera.projectionMatrix
        );

        gl.uniformMatrix4fv(
            this.uniformModelViewMatrixLocation,
            false,
            this.camera.viewMatrix
        );

        gl.drawArrays(gl.POINTS, 0, points.length);

        return output;
    }

    initShaders() {
        console.log("initializing shaders");
        const gl = this.gl;

        // Initialize shaders
        const vsSource = `#version 300 es
        in vec4 a_position;
        in vec4 a_color;
        uniform mat4 u_projectionMatrix;
        uniform mat4 u_modelViewMatrix;

        out vec4 v_color;

        void main() {
            gl_Position = u_projectionMatrix * u_modelViewMatrix * a_position;
            gl_PointSize = 20.0;
            v_color = a_color;
        }
    `;

        const fsSource = `#version 300 es
        precision highp float;
        in vec4 v_color;    
        out vec4 fragColor;
        void main() {
            fragColor = v_color;
        }
    `;

        // Setup GLSL program
        this.program = createProgram(gl, vsSource, fsSource);
        if (!this.program) {
            alert("Could not initialize shaders");
        }

        // get program attributes locations
        this.attribPositionLocation = gl.getAttribLocation(this.program, "a_position");
        this.attribColorLocation = gl.getAttribLocation(this.program, "a_color");
        // get program uniforms locations
        this.uniformProjectionMatrixLocation = gl.getUniformLocation(this.program, "u_projectionMatrix");
        this.uniformModelViewMatrixLocation = gl.getUniformLocation(this.program, "u_modelViewMatrix");
    }

    initData() {
        console.log("initializing data");
        const gl = this.gl;

        const flatPositions = points.map(point => point.geometry).flat();
        let renderCoordinates = new Float32Array(points.length * 3);
        webgl.toRenderCoordinates(this.view, flatPositions, 0, SpatialReference.WGS84, renderCoordinates, 0, points.length);
        this.vboPositions = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, this.vboPositions);
        gl.bufferData(gl.ARRAY_BUFFER, renderCoordinates, gl.STATIC_DRAW);

        const colors = points.map(point => point.color).flat();
        this.vboColor = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, this.vboColor);
        gl.bufferData(gl.ARRAY_BUFFER, new Uint8Array(colors), gl.STATIC_DRAW);

    }
}

// reactiveUtils.whenOnce(() => !view.updating).then(() => {
//     new GeometryRenderNode({ view });
// });

view.when(() => {
    new GeometryRenderNode({ view });
});

(window as any).view = view;