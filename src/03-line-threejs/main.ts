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
import * as THREE from "three";
import { Line2 } from "three/examples/jsm/lines/Line2";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial";
import { LineGeometry } from "three/examples/jsm/lines/LineGeometry";
import { whenOnce } from "@arcgis/core/core/reactiveUtils";


interface Vertex {
    x: number;
    y: number;
    z: number;
    color: Array<number>;
    time?: string;
}

const NO_SEG = 20;
const NO_POSITION_COORDS = 3;
const NO_COLOR_COORDS = 4;
let vertices: Array<Vertex> = null;

const start = {
    x: -71.087986,
    y: 42.336244,
    z: 0,
    color: [252, 144, 3, 1],
    time: "2023-09-01 07:00:06"
};
const end = {
    x: -71.076546,
    y: 42.366447,
    z: 0,
    color: [3, 215, 252, 1],
    time: "2023-09-01 07:16:59"
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
    consumes: __esri.ConsumedNodes = { required: ["opaque-color"] };
    produces: __esri.RenderNodeOutput = "opaque-color";

    threeRenderer: THREE.WebGLRenderer = null;
    threeScene: THREE.Scene = null;
    threeCamera: THREE.PerspectiveCamera;

    setup() {
        this.threeScene = new THREE.Scene();
        this.threeCamera = new THREE.PerspectiveCamera();

        const numPoints = vertices.length;
        let positions = [];
        let colors = [];

        for (let i = 0; i < numPoints; i++) {
            const { x, y, z, color } = vertices[i];
            const renderCoords = webgl.toRenderCoordinates(view, [x, y, z], 0, SpatialReference.WebMercator, new Float32Array(3), 0, 1);
            for (let j = 0; j < NO_POSITION_COORDS; j++) {
                positions[i * NO_POSITION_COORDS + j] = renderCoords[j];
            }
            for (let j = 0; j < NO_POSITION_COORDS; j++) {
                colors[i * NO_POSITION_COORDS + j] = color[j];
            }
        }

        console.log(positions, colors);
        const geometry = new LineGeometry();
        geometry.setPositions(positions);
        geometry.setColors(colors);
        const matLine = new LineMaterial({

            color: 0xffffff,
            linewidth: 5, // in world units with size attenuation, pixels otherwise
            vertexColors: true,

            //resolution:  // to be set by renderer, eventually
            dashed: false,
            //alphaToCoverage: true,

        });

        const line = new Line2(geometry, matLine);
        this.threeScene.add(line);

        this.threeRenderer = new THREE.WebGLRenderer({
            context: this.gl
        });
        this.threeRenderer.autoClear = true;
        this.threeRenderer.autoClearDepth = false;
        this.threeRenderer.autoClearColor = false;
        this.threeRenderer.autoClearStencil = false;
    }

    override render(inputs: ManagedFBO[]): ManagedFBO {
        const output = this.bindRenderTarget();

        const { width, height } = this.view;

        if (!this.threeScene) {
            this.setup();
        }
        this.threeRenderer.resetState();
        const c = this.camera;

        this.threeCamera.position.set(c.eye[0], c.eye[1], c.eye[2]);
        this.threeCamera.up.set(c.up[0], c.up[1], c.up[2]);
        this.threeCamera.lookAt(new THREE.Vector3(c.center[0], c.center[1], c.center[2]));
        this.threeCamera.projectionMatrix.fromArray(c.projectionMatrix);

        this.threeRenderer.setSize(width, height);
        this.threeRenderer.setPixelRatio(window.devicePixelRatio);

        this.threeRenderer.render(this.threeScene, this.threeCamera);

        this.resetWebGLState();
        this.threeRenderer.resetState();
        return output;
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
    whenOnce(() => !view.updating).then(() => {
        const [start_x, start_y] = webMercatorUtils.lngLatToXY(start.x, start.y);
        const [end_x, end_y] = webMercatorUtils.lngLatToXY(end.x, end.y);
        vertices = calculatePointsOnParaboloid({ start: { ...start, x: start_x, y: start_y }, end: { ...end, x: end_x, y: end_y } });
        new GeometryRenderNode({ view });
    });

} catch (error) {
    console.error(error);
}

