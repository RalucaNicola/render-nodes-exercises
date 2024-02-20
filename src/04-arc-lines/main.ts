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
import { watch } from "@arcgis/core/core/reactiveUtils";
import TimeInterval from "@arcgis/core/TimeInterval";
import TimeSlider from "@arcgis/core/widgets/TimeSlider";

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
    time: number;
    endTime: number;
}

const NO_SEG = 30;
const NO_POSITION_COORDS = 3;
const NO_COLOR_COORDS = 4;
let startDate: Date = null;
let endDate: Date = null;
let currentTime: number = null;
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
    attribTimeLocation: number;
    attribEndTimeLocation: number;
    uniformCurrentTimeLocation: WebGLUniformLocation;
    uniformProjectionMatrixLocation: WebGLUniformLocation;
    uniformModelViewMatrixLocation: WebGLUniformLocation;

    vboPositions: WebGLBuffer;
    vboColor: WebGLBuffer;
    vboTime: WebGLBuffer;
    vboEndTime: WebGLBuffer;

    initialize() {
        this.initShaders();
        this.initData();
    }

    override render(inputs: ManagedFBO[]): ManagedFBO {

        const output = this.bindRenderTarget();
        const gl = this.gl;
        gl.enable(gl.DEPTH_TEST);
        gl.enable(gl.CULL_FACE);
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

        gl.bindBuffer(gl.ARRAY_BUFFER, this.vboEndTime);
        gl.enableVertexAttribArray(this.attribEndTimeLocation);
        gl.vertexAttribPointer(this.attribEndTimeLocation, 1, gl.FLOAT, false, 0, 0);

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
        in float a_endTime;
        uniform float u_currentTime;
        uniform mat4 u_projectionMatrix;
        uniform mat4 u_modelViewMatrix;

        out vec4 v_color;

        void main() {
            float alpha;
            float timeDiff = u_currentTime - a_endTime;
            gl_Position = u_projectionMatrix * u_modelViewMatrix * a_position;
            if ( timeDiff > 360000.0) {
                alpha = max(0.1, 0.1 - 0.9 * (timeDiff - 600000.0) / 240000.0);
            } else {
                if (a_time - u_currentTime > 0.0) {
                    alpha = 0.0;
                } else {
                    alpha = 1.0;
                }
            }
            
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
        this.attribEndTimeLocation = gl.getAttribLocation(this.program, "a_endTime");
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
        let endTimes = new Float32Array(numPoints);

        for (let i = 0; i < numPoints; i++) {
            const { x, y, z, color, time, endTime } = vertices[i];
            const renderCoords = webgl.toRenderCoordinates(view, [x, y, z], 0, SpatialReference.WebMercator, new Float32Array(3), 0, 1);
            for (let j = 0; j < NO_POSITION_COORDS; j++) {
                positions[i * NO_POSITION_COORDS + j] = renderCoords[j];
            }
            for (let j = 0; j < NO_COLOR_COORDS; j++) {
                colors[i * NO_COLOR_COORDS + j] = color[j];
            }
            times[i] = time;
            endTimes[i] = endTime;
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

        this.vboEndTime = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, this.vboEndTime);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(endTimes), gl.STATIC_DRAW);
    }
}

export function calculatePointsOnParaboloid({ start, end }: { start: Vertex, end: Vertex }) {
    const points: Array<Vertex> = [];
    const H = 1.0;
    const { x: xs, y: ys, z: zs, time: time_s } = start;
    const { x: xe, y: ye, z: ze, time: time_e } = end;
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
        const time = time_s + (time_e - time_s) * ratio;
        points.push({ x, y, z, color: [r, g, b, Math.floor(a * 255)], time, endTime: time_e })
    }
    return points;
}

try {
    view.when(() => {
        Papa.parse("./trips_0109_cambridge.csv", {
            delimiter: ",", download: true, header: true, dynamicTyping: true, complete: (result) => {
                // sort by time
                result.data.sort((a: Trip, b: Trip) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());
                startDate = new Date((result.data[0] as Trip).startTime);
                endDate = new Date((result.data[result.data.length - 1] as Trip).endTime);
                currentTime = startDate.getTime() - startDate.getTime();
                const trips = result.data.map((trip: Trip) => {
                    if (trip && trip.tripID) {
                        const { start_lng, start_lat, end_lng, end_lat, startTime, endTime } = trip;
                        const [startX, startY] = webMercatorUtils.lngLatToXY(start_lng, start_lat);
                        const [endX, endY] = webMercatorUtils.lngLatToXY(end_lng, end_lat);
                        const start = {
                            x: startX,
                            y: startY,
                            z: 50,
                            color: [252, 144, 3, 0],
                            time: new Date(startTime).getTime() - startDate.getTime(),
                            endTime: new Date(endTime).getTime() - startDate.getTime()
                        }
                        const end = {
                            x: endX,
                            y: endY,
                            z: 50,
                            color: [3, 215, 252, 0],
                            time: new Date(endTime).getTime() - startDate.getTime(),
                            endTime: new Date(endTime).getTime() - startDate.getTime()
                        }
                        return calculatePointsOnParaboloid({ start, end });

                    }
                });

                vertices = trips.flat();
                const renderNode = new GeometryRenderNode({ view });

                const stopsCount = Math.floor((endDate.getTime() - startDate.getTime()) / 30000);

                const timeSlider = new TimeSlider({
                    mode: "cumulative-from-start",
                    view,
                    fullTimeExtent: {
                        start: startDate,
                        end: endDate
                    },
                    playRate: 100,
                    stops: {
                        count: stopsCount
                    }
                });

                view.ui.add(timeSlider, "bottom-left");

                watch(
                    () => timeSlider.timeExtent,
                    (value) => {
                        currentTime = value.end.getTime() - startDate.getTime();
                        renderNode.requestRender();
                    }
                );
            }
        })
    });

} catch (error) {
    console.error(error);
}
