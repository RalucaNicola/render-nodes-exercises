import SceneView from '@arcgis/core/views/SceneView';
import * as webgl from "@arcgis/core/views/3d/webgl";
import { SpatialReference } from "@arcgis/core/geometry";
import WebScene from '@arcgis/core/WebScene';
import { subclass } from "@arcgis/core/core/accessorSupport/decorators";
import RenderNode from "@arcgis/core/views/3d/webgl/RenderNode";
import ManagedFBO from "@arcgis/core/views/3d/webgl/ManagedFBO";
import * as THREE from "three";
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass';
import { DotScreenPass } from 'three/examples/jsm/postprocessing/DotScreenPass';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass';
import { GlitchPass } from 'three/examples/jsm/postprocessing/GlitchPass';
const view = new SceneView({
    container: "viewDiv",
    map: new WebScene({
        portalItem: {
            id: "9beec9328ca24cd0ae38b3657471d329"
        }
    }),

    viewingMode: "global",

    qualityProfile: "high",

    environment: {
        atmosphere: {
            quality: "high"
        },

        lighting: {
            directShadowsEnabled: true
        }
    },
});


@subclass("esri.views.3d.AddGeometryRenderPass")
class AddGeometryRenderPass extends RenderNode {
    consumes: __esri.ConsumedNodes = { required: ["opaque-color"] };
    produces: __esri.RenderNodeOutput = "opaque-color";

    threeRenderer: THREE.WebGLRenderer = null;
    effectComposer: EffectComposer;
    threeScene: THREE.Scene = null;
    threeCamera: THREE.PerspectiveCamera;
    directionalLight: THREE.DirectionalLight;
    ambientLight: THREE.AmbientLight;

    setup() {
        this.threeScene = new THREE.Scene();
        this.threeCamera = new THREE.PerspectiveCamera();

        const geometry = new THREE.BoxGeometry(10, 10, 10);
        const material = new THREE.MeshBasicMaterial({ color: "#ff0000" });
        const cube = new THREE.Mesh(geometry, material);
        const renderCoords = webgl.toRenderCoordinates(view, [950763.6511, 6002193.8497, 450], 0, SpatialReference.WebMercator, new Float64Array(3), 0, 1);
        cube.position.set(renderCoords[0], renderCoords[1], renderCoords[2]);
        this.threeScene.add(cube);

        this.directionalLight = new THREE.DirectionalLight(0xffffff, 0.5);
        this.ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
        this.threeScene.add(
            this.directionalLight,
            this.ambientLight
        );

        this.threeRenderer = new THREE.WebGLRenderer({
            context: this.gl
        });
        this.threeRenderer.autoClear = false;
        this.threeRenderer.autoClearDepth = false;
        this.threeRenderer.autoClearColor = false;
        this.threeRenderer.autoClearStencil = false;

    }

    override render(_inputs: ManagedFBO[]): ManagedFBO {
        const output = this.bindRenderTarget();
        const { width, height } = this.view;

        if (!this.threeScene) {
            this.setup();
        }

        const direction = this.sunLight.direction;
        const diffuse = this.sunLight.diffuse;
        const ambient = this.sunLight.ambient;

        this.directionalLight.color.setRGB(diffuse.color[0], diffuse.color[1], diffuse.color[2]);
        this.directionalLight.intensity = diffuse.intensity;
        this.directionalLight.position.set(direction[0], direction[1], direction[2]);

        this.ambientLight.color.setRGB(ambient.color[0], ambient.color[1], ambient.color[2]);
        this.ambientLight.intensity = ambient.intensity;

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

new AddGeometryRenderPass({ view });

// a function for testing that cube rendering works in ThreeJS alone
function pureThreeJSCube() {
    const canvas = document.querySelector('canvas.webgl') as HTMLCanvasElement;

    const sizes = {
        width: canvas.width,
        height: canvas.height
    }
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(75, sizes.width / sizes.height, 0.1, 100);
    camera.position.z = 3;

    // Create a cube
    const geometry = new THREE.BoxGeometry(1, 1, 1);
    const material = new THREE.MeshBasicMaterial({ color: "#ff0000" });
    const cube = new THREE.Mesh(geometry, material);
    scene.add(cube);

    const renderer = new THREE.WebGLRenderer({
        canvas: canvas,
        antialias: true
    })
    renderer.setSize(sizes.width, sizes.height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

    const effectComposer = new EffectComposer(renderer)
    effectComposer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    effectComposer.setSize(sizes.width, sizes.height)

    const renderPass = new RenderPass(scene, camera);
    effectComposer.addPass(renderPass);

    const dotScreenPass = new DotScreenPass();
    effectComposer.addPass(dotScreenPass);

    const glitchPass = new GlitchPass();
    effectComposer.addPass(glitchPass);

    const unrealBloomPass = new UnrealBloomPass(new THREE.Vector2(sizes.width, sizes.height), 0.5, 3, 0);
    effectComposer.addPass(unrealBloomPass);


    function render() {
        effectComposer.render();
        // requestAnimationFrame(render);
    }

    render();
}
