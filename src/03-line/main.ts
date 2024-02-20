import WebScene from "@arcgis/core/WebScene";
import { subclass } from "@arcgis/core/core/accessorSupport/decorators";
import ManagedFBO from "@arcgis/core/views/3d/webgl/ManagedFBO";
import RenderNode from "@arcgis/core/views/3d/webgl/RenderNode";
import SceneView from "@arcgis/core/views/SceneView";
import { createProgram } from "../utils";
import * as webgl from "@arcgis/core/views/3d/webgl";
import SpatialReference from "@arcgis/core/geometry/SpatialReference";
import Color from "@arcgis/core/Color";
import * as webMercatorUtils from "@arcgis/core/geometry/support/webMercatorUtils";
import TimeSlider from "@arcgis/core/widgets/TimeSlider";
import { watch } from "@arcgis/core/core/reactiveUtils";

interface Vertex {
    x: number;
    y: number;
    z: number;
    color: Array<number>;
    time?: number;
}

const NO_SEG = 100;
const NO_POSITION_COORDS = 3;
const NO_COLOR_COORDS = 4;
let vertices: Array<Vertex> = null;
const startDate = new Date("2023-09-01 07:00:00");
const endDate = new Date("2023-09-01 07:20:00");
let currentTime = startDate.getTime();
const start = {
    x: -71.087986,
    y: 42.336244,
    z: 0,
    color: [252, 144, 3, 1],
    time: startDate.getTime() - startDate.getTime()
};
const end = {
    x: -71.076546,
    y: 42.366447,
    z: 0,
    color: [3, 215, 252, 1],
    time: endDate.getTime() - startDate.getTime()
};

const view = new SceneView({
    container: "viewDiv",
    map: new WebScene({
        portalItem: {
            id: '0e4333f1fd52435a8568ba7d09172b83'
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
    }
});

(window as any).view = view;

@subclass("esr.views.3d.GeometryRenderNode")
class GeometryRenderNode extends RenderNode {
    consumes: __esri.ConsumedNodes = { required: ["transparent-color"] };
    produces: __esri.RenderNodeOutput = "transparent-color";

    program: WebGLProgram;

    attribPositionLocation: number;
    attribColorLocation: number;
    attribTimeLocation: number;
    uniformCurrentTimeLocation: WebGLUniformLocation;
    uniformProjectionMatrixLocation: WebGLUniformLocation;
    uniformModelViewMatrixLocation: WebGLUniformLocation;

    vboPositions: WebGLBuffer;
    vboColor: WebGLBuffer;
    vboTime: WebGLBuffer;

    initialize() {
        this.initShaders();
        this.initData();
    }

    override render(inputs: ManagedFBO[]): ManagedFBO {

        const output = this.bindRenderTarget();
        const gl = this.gl;
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

        gl.bindBuffer(gl.ARRAY_BUFFER, this.vboPositions);
        gl.enableVertexAttribArray(this.attribPositionLocation);
        gl.vertexAttribPointer(this.attribPositionLocation, 3, gl.FLOAT, false, 0, 0);

        gl.bindBuffer(gl.ARRAY_BUFFER, this.vboColor);
        gl.enableVertexAttribArray(this.attribColorLocation);
        gl.vertexAttribPointer(this.attribColorLocation, 4, gl.UNSIGNED_BYTE, true, 0, 0);

        gl.bindBuffer(gl.ARRAY_BUFFER, this.vboTime);
        gl.enableVertexAttribArray(this.attribTimeLocation);
        gl.vertexAttribPointer(this.attribTimeLocation, 1, gl.FLOAT, false, 0, 0);

        gl.useProgram(this.program);

        gl.uniform1f(this.uniformCurrentTimeLocation, currentTime);

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

        for (let i = 0; i <= vertices.length; i += NO_SEG) {
            gl.drawArrays(gl.LINE_STRIP, i, NO_SEG);
        }
        this.resetWebGLState();

        return output;
    }

    initShaders() {
        const gl = this.gl;

        // Initialize shaders
        const vsSource = `#version 300 es
        in vec4 a_position;
        in vec4 a_color;
        in float a_time;
        uniform float u_currentTime;
        uniform mat4 u_projectionMatrix;
        uniform mat4 u_modelViewMatrix;

        out vec4 v_color;

        void main() {
            gl_Position = u_projectionMatrix * u_modelViewMatrix * a_position;
            float alpha = step(a_time, u_currentTime);
            v_color = vec4(a_color.xyz, alpha);
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
        this.attribTimeLocation = gl.getAttribLocation(this.program, "a_time");
        // get program uniforms locations
        this.uniformCurrentTimeLocation = gl.getUniformLocation(this.program, "u_currentTime");
        this.uniformProjectionMatrixLocation = gl.getUniformLocation(this.program, "u_projectionMatrix");
        this.uniformModelViewMatrixLocation = gl.getUniformLocation(this.program, "u_modelViewMatrix");
    }

    initData() {
        const gl = this.gl;
        console.log(vertices);
        const numPoints = vertices.length;
        let positions = new Float32Array(numPoints * NO_POSITION_COORDS);
        let colors = new Float32Array(numPoints * NO_COLOR_COORDS);
        let times = new Float32Array(numPoints);

        for (let i = 0; i < numPoints; i++) {
            const { x, y, z, color } = vertices[i];
            const renderCoords = webgl.toRenderCoordinates(view, [x, y, z], 0, SpatialReference.WebMercator, new Float32Array(3), 0, 1);
            for (let j = 0; j < NO_POSITION_COORDS; j++) {
                positions[i * NO_POSITION_COORDS + j] = renderCoords[j];
            }
            for (let j = 0; j < NO_COLOR_COORDS; j++) {
                colors[i * NO_COLOR_COORDS + j] = color[j];
            }
            times[i] = vertices[i].time;
        }

        this.vboPositions = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, this.vboPositions);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(positions), gl.STATIC_DRAW);

        this.vboColor = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, this.vboColor);
        gl.bufferData(gl.ARRAY_BUFFER, new Uint8Array(colors), gl.STATIC_DRAW);

        this.vboTime = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, this.vboTime);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(times), gl.STATIC_DRAW);

    }
}

export function calculatePointsOnParaboloid({ start, end }: { start: Vertex, end: Vertex }) {
    const points: Array<Vertex> = [];
    const H = 0.5;
    const { x: xs, y: ys, z: zs, time: time_s } = start;
    const { x: xe, y: ye, z: ze, time: time_e } = end;
    const distance = Math.sqrt((xe - xs) ** 2 + (ye - ys) ** 2);
    const deltaZ = ze - zs;
    const dh = distance * H;
    for (let i = 0; i < NO_SEG; i++) {
        const unitZ = deltaZ / dh;
        const p = unitZ * unitZ + 1;
        const z0 = deltaZ >= 0 ? zs : ze;
        const ratio = deltaZ >= 0 ? i / (NO_SEG - 1) : (1 - (i / (NO_SEG - 1)));
        const x = xs * ratio + xe * (1 - ratio);
        const y = ys * ratio + ye * (1 - ratio);
        const z = ratio * (p - ratio) * dh + z0;
        const color = Color.blendColors(new Color(start.color), new Color(end.color), ratio);
        const { r, g, b } = color;
        const time = time_s + (time_e - time_s) * ratio;
        console.log(time);
        points.push({ x, y, z, color: [r, g, b, 0], time })
    }
    return points;
}

try {
    view.when(() => {
        const [start_x, start_y] = webMercatorUtils.lngLatToXY(start.x, start.y);
        const [end_x, end_y] = webMercatorUtils.lngLatToXY(end.x, end.y);
        vertices = calculatePointsOnParaboloid({ start: { ...start, x: start_x, y: start_y }, end: { ...end, x: end_x, y: end_y } });
        const renderNode = new GeometryRenderNode({ view });
        const stopsCount = Math.floor((endDate.getTime() - startDate.getTime()) / 30000);

        const timeSlider = new TimeSlider({
            mode: "cumulative-from-start",
            view,
            fullTimeExtent: {
                start: startDate,
                end: endDate
            },
            playRate: 50,
            stops: {
                count: stopsCount,
            }
        });
        view.ui.add(timeSlider, "bottom-left");

        watch(
            () => timeSlider.timeExtent,
            (value) => {
                console.log(value.end);
                currentTime = value.end.getTime() - startDate.getTime();
                renderNode.requestRender();
            }
        );
    });

} catch (error) {
    console.error(error);
}

