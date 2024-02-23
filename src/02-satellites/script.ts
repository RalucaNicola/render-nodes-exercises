import WebScene from "@arcgis/core/WebScene";
import { subclass } from "@arcgis/core/core/accessorSupport/decorators";
import ManagedFBO from "@arcgis/core/views/3d/webgl/ManagedFBO";
import RenderNode from "@arcgis/core/views/3d/webgl/RenderNode";
import SceneView from "@arcgis/core/views/SceneView";
import { createProgram } from "../utils";
import * as webgl from "@arcgis/core/views/3d/webgl";
import SpatialReference from "@arcgis/core/geometry/SpatialReference";
import request from "@arcgis/core/request";
import * as reactiveUtils from "@arcgis/core/core/reactiveUtils";
import { twoline2satrec, propagate, eciToGeodetic, gstime, EciVec3 } from "satellite.js";

const view = new SceneView({
    container: "viewDiv",
    map: new WebScene({
        portalItem: {
            id: '53411b46fdbe4161b356030eae9905e0'
        }
    }),

    qualityProfile: "high",
    viewingMode: "global",
    camera: {
        position: [
            4233715.11713637,
            3862585.55396099,
            118009062.73685
        ],
        heading: 0.00,
        tilt: 0.03
    },
    environment: {
        atmosphere: {
            quality: "high"
        },

        lighting: {
            type: "virtual"
        }
    },
    constraints: {
        altitude: {
            max: 1e9
        },
        clipDistance: {
            mode: 'manual',
            near: 1e4,
            far: 1e9 + 5e10
        }
    },
});

let url = "./active.txt";
const satellites: Satellite[] = [];

const main = async () => {
    try {
        const response = await request(url, {
            responseType: "text"
        });
        const txt = response.data;

        // Parse the satellite TLE data
        const lines = txt.split("\n");
        const count = Math.floor(lines.length / 3);

        for (let i = 0; i < count; i++) {

            const commonName = lines[i * 3];
            let line1 = lines[i * 3 + 1];
            let line2 = lines[i * 3 + 2];
            let time = Date.now();

            let satelliteLoc = getSatelliteLocation(new Date(time), line1, line2);
            if (satelliteLoc) { satellites.push(satelliteLoc) }

        }

        reactiveUtils.whenOnce(() => !view.updating).then(() => {
            new GeometryRenderNode({ view });
        });

    } catch (error) {
        console.error(error);
    }

}
main();

interface Satellite {
    geometry: number[]
    color: number[];
}

let distance = 1e10;

function lerp(a: number, b: number, t: number) {
    return a + (b - a) * t;
}

function easeIn(t: number) {
    return t * t;
}

const duration = 8000;

@subclass("esr.views.3d.GeometryRenderNode")
class GeometryRenderNode extends RenderNode {
    consumes: __esri.ConsumedNodes = { required: ["opaque-color"] };
    produces: __esri.RenderNodeOutput = "opaque-color";

    time = Date.now();
    deltaTime = 0;

    program: WebGLProgram;

    attribPositionLocation: number;
    attribColorLocation: number;
    uniformProjectionMatrixLocation: WebGLUniformLocation;
    uniformModelViewMatrixLocation: WebGLUniformLocation;
    uniformDistanceLocation: WebGLUniformLocation;

    vboPositions: WebGLBuffer;
    vboColor: WebGLBuffer;

    initialize() {
        this.initShaders();
        this.initData();
    }

    override render(inputs: ManagedFBO[]): ManagedFBO {
        const output = this.bindRenderTarget();
        const gl = this.gl;
        this.deltaTime = Date.now() - this.time

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
        gl.uniform1f(this.uniformDistanceLocation, distance);

        gl.drawArrays(gl.POINTS, 0, satellites.length);
        if (distance > 0) {
            distance *= lerp(1, 0, easeIn(this.deltaTime / duration));
            this.requestRender();
        }

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
        uniform float u_distance;

        out vec4 v_color;

        void main() {
            vec4 position = vec4(a_position.xyz * (1.0 + u_distance / length(a_position.xyz)), 1.0);
            gl_Position = u_projectionMatrix * u_modelViewMatrix * position;
            gl_PointSize = 2.0;
            v_color = a_color;
        }
    `;

        const fsSource = `#version 300 es
        precision highp float;
        in vec4 v_color;    
        out vec4 fragColor;
        void main() {
            fragColor = vec4(1.0, 1.0, 1.0, 1.0);
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
        this.uniformDistanceLocation = gl.getUniformLocation(this.program, "u_distance");
        this.uniformProjectionMatrixLocation = gl.getUniformLocation(this.program, "u_projectionMatrix");
        this.uniformModelViewMatrixLocation = gl.getUniformLocation(this.program, "u_modelViewMatrix");
    }

    initData() {
        const gl = this.gl;

        const flatPositions = satellites.map(satellite => satellite.geometry).flat();
        let renderCoordinates = new Float32Array(satellites.length * 3);
        webgl.toRenderCoordinates(this.view, flatPositions, 0, SpatialReference.WGS84, renderCoordinates, 0, satellites.length);
        this.vboPositions = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, this.vboPositions);
        gl.bufferData(gl.ARRAY_BUFFER, renderCoordinates, gl.STATIC_DRAW);

        const colors = satellites.map(satellite => satellite.color).flat();
        this.vboColor = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, this.vboColor);
        gl.bufferData(gl.ARRAY_BUFFER, new Uint8Array(colors), gl.STATIC_DRAW);

    }
}


(window as any).view = view;

function getSatelliteLocation(date: Date, line1: string, line2: string) {
    /****************************************************
     * satellite-js is a library that includes a set of
     * functions to convert TLE to geographic locations
     * We use this to get the geographic location of the
     * satellites for the current date. For more details
     * on satellite-js visib the github repo
     * https://github.com/shashwatak/satellite-js
     ****************************************************/
    const satrec = twoline2satrec(line1, line2);
    const position_and_velocity = propagate(
        satrec,
        date
    );
    const position_eci = position_and_velocity.position as EciVec3<number>;

    const gmst = gstime(
        date.getUTCFullYear(),
        date.getUTCMonth() + 1,
        date.getUTCDate(),
        date.getUTCHours(),
        date.getUTCMinutes(),
        date.getUTCSeconds()
    );

    const position_gd = eciToGeodetic(position_eci, gmst);

    let longitude = position_gd.longitude;
    let latitude = position_gd.latitude;
    let height = position_gd.height;
    if (isNaN(longitude) || isNaN(latitude) || isNaN(height)) {
        return null;
    }
    const rad2deg = 180 / Math.PI;
    while (longitude < -Math.PI) {
        longitude += 2 * Math.PI;
    }
    while (longitude > Math.PI) {
        longitude -= 2 * Math.PI;
    }
    return {
        geometry: [rad2deg * longitude, rad2deg * latitude, height * 1000],
        color: [Math.random() * 255, Math.random() * 255, Math.random() * 255, 255]
    };
}