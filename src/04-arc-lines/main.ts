import WebScene from "@arcgis/core/WebScene";
import { subclass } from "@arcgis/core/core/accessorSupport/decorators";
import ManagedFBO from "@arcgis/core/views/3d/webgl/ManagedFBO";
import RenderNode from "@arcgis/core/views/3d/webgl/RenderNode";
import SceneView from "@arcgis/core/views/SceneView";
import { createProgram } from "../utils";
import * as webgl from "@arcgis/core/views/3d/webgl";
import SpatialReference from "@arcgis/core/geometry/SpatialReference";
import Papa from "papaparse";
import Color from "@arcgis/core/Color";
import * as webMercatorUtils from "@arcgis/core/geometry/support/webMercatorUtils";

interface Trip {
    tripID: string;
    start_lng: number;
    start_lat: number;
    end_lng: number;
    end_lat: number;
    startTime: string;
    endTime: string;
}

interface Vertex {
    x: number;
    y: number;
    z: number;
    color: Array<number>;
}

const NO_SEG = 20;
const NO_POSITION_COORDS = 3;
const NO_COLOR_COORDS = 4;
let vertices: Array<Vertex> = null;

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
    uniformProjectionMatrixLocation: WebGLUniformLocation;
    uniformModelViewMatrixLocation: WebGLUniformLocation;

    vboPositions: WebGLBuffer;
    vboColor: WebGLBuffer;

    initialize() {
        this.initShaders();
        this.initData();
    }

    override render(inputs: ManagedFBO[]): ManagedFBO {
        this.resetWebGLState();
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

        for (let i = 0; i <= vertices.length; i += 20) {
            gl.drawArrays(gl.LINE_STRIP, i, 20);
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
        uniform mat4 u_projectionMatrix;
        uniform mat4 u_modelViewMatrix;

        out vec4 v_color;

        void main() {
            gl_Position = u_projectionMatrix * u_modelViewMatrix * a_position;
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
        const gl = this.gl;

        const numPoints = vertices.length;
        let positions = new Float32Array(numPoints * NO_POSITION_COORDS);
        let colors = new Float32Array(numPoints * NO_COLOR_COORDS);

        for (let i = 0; i < numPoints; i++) {
            const { x, y, z, color } = vertices[i];
            const renderCoords = webgl.toRenderCoordinates(view, [x, y, z], 0, SpatialReference.WebMercator, new Float32Array(3), 0, 1);
            for (let j = 0; j < NO_POSITION_COORDS; j++) {
                positions[i * NO_POSITION_COORDS + j] = renderCoords[j];
            }
            for (let j = 0; j < NO_COLOR_COORDS; j++) {
                colors[i * NO_COLOR_COORDS + j] = color[j];
            }
        }

        console.log(positions, colors);

        this.vboPositions = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, this.vboPositions);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(positions), gl.STATIC_DRAW);

        this.vboColor = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, this.vboColor);
        gl.bufferData(gl.ARRAY_BUFFER, new Uint8Array(colors), gl.STATIC_DRAW);

    }
}

export function calculatePointsOnParaboloid({ start, end }: { start: Vertex, end: Vertex }) {
    const points: Array<Vertex> = [];
    const H = 0.5;
    const { x: xs, y: ys, z: zs } = start;
    const { x: xe, y: ye, z: ze } = end;
    const distance = Math.sqrt((xe - xs) ** 2 + (ye - ys) ** 2);
    const deltaZ = ze - zs;
    const dh = distance * H;
    for (let i = 0; i < NO_SEG; i++) {
        const unitZ = deltaZ / dh;
        const p = unitZ * unitZ + 1;
        const z0 = deltaZ >= 0 ? zs : ze;
        const ratio = deltaZ > 0 ? i / (NO_SEG - 1) : (1 - (i / (NO_SEG - 1)));
        const x = xs * ratio + xe * (1 - ratio);
        const y = ys * ratio + ye * (1 - ratio);
        const z = ratio * (p - ratio) * dh + z0;
        const color = Color.blendColors(new Color(start.color), new Color(end.color), ratio);
        const { r, g, b, a } = color;
        points.push({ x, y, z, color: [r, g, b, a * 255] })
    }
    return points;
}

try {
    view.when(() => {
        Papa.parse("./trips_0109_cambridge.csv", {
            delimiter: ",", download: true, header: true, dynamicTyping: true, complete: (result) => {

                const trips = result.data.map((trip: Trip) => {
                    if (trip && trip.tripID) {
                        const { start_lng, start_lat, end_lng, end_lat } = trip;
                        const [start_x, start_y] = webMercatorUtils.lngLatToXY(start_lng, start_lat);
                        const [end_x, end_y] = webMercatorUtils.lngLatToXY(end_lng, end_lat);
                        const start = {
                            x: start_x,
                            y: start_y,
                            z: 0,
                            color: [255, 0, 0, 100]
                        }
                        const end = {
                            x: end_x,
                            y: end_y,
                            z: 0,
                            color: [0, 255, 0, 100]
                        }
                        return calculatePointsOnParaboloid({ start, end });

                    }
                });

                vertices = trips.flat();
                new GeometryRenderNode({ view });
            }
        })
    });

} catch (error) {
    console.error(error);
}

