import {WglArg} from "src/webgl/WglArg.js"

/**
 * A piece of a shader.
 *
 * Because some GPUs don't support float textures very well, inputs and outputs may need to be processed into
 * appropriate forms before computing/storing. Instead of having every shader do it, the conversion functionality is
 * abstracted into decorator instances.
 */
class ShaderPart {
    /**
     * @param {!string} code
     * @param {!Array.<!string>} libs
     * @param {!function(!WglTexture) : !Array.!<WglArg>} argsFor
     */
    constructor(code, libs, argsFor) {
        /** @type {!string} */
        this.code = code;
        /** @type {!Array.<!string>} */
        this.libs = libs;
        /** @type {!function(!WglTexture) : !Array.!<WglArg>} */
        this.argsFor = argsFor;
    }
}

/**
 * A strategy for converting and shading with a specific type of value array.
 */
class SingleTypeCoder {
    /**
     * @param {!function(name: !string) : !ShaderPart} inputPartGetter
     * @param {!ShaderPart} outputPart
     * @param {!int} powerSizeOverhead
     * @param {!int} pixelType
     * @param {!function(*) : !Float32Array|!Uint8Array} dataToPixels
     * @param {!function(!Float32Array|!Uint8Array) : *} pixelsToData
     * @param {!boolean} needRearrangingToBeInVec4Format
     */
    constructor(inputPartGetter,
                outputPart,
                powerSizeOverhead,
                pixelType,
                dataToPixels,
                pixelsToData,
                needRearrangingToBeInVec4Format) {
        /** @type {!function(name: !string) : !ShaderPart} */
        this.inputPartGetter = inputPartGetter;
        /** @type {!ShaderPart} */
        this.outputPart = outputPart;
        /** @type {!int} */
        this.powerSizeOverhead = powerSizeOverhead;
        /** @type {!int} */
        this.pixelType = pixelType;
        /** @type {!function(*) : !Float32Array|!Uint8Array} */
        this.dataToPixels = dataToPixels;
        /** @type {!function(!Float32Array|!Uint8Array) : *} */
        this.pixelsToData = pixelsToData;
        /** @type {!boolean} */
        this.needRearrangingToBeInVec4Format = needRearrangingToBeInVec4Format;
    }

    /**
     * @param {!WglTexture} tex
     * @returns {!int}
     */
    arrayPowerSizeOfTexture(tex) {
        return tex.sizePower() - this.powerSizeOverhead;
    }
}

/**
 * A strategy for converting between values used inside the shader and the textures those values must live in between
 * shaders.
 */
class ShaderCoder {
    /**
     * @param {!SingleTypeCoder} bool
     * @param {!SingleTypeCoder} float
     * @param {!SingleTypeCoder} vec2
     * @param {!SingleTypeCoder} vec4
     */
    constructor(bool, float, vec2, vec4) {
        /** @type {!SingleTypeCoder} */
        this.bool = bool;
        /** @type {!SingleTypeCoder} */
        this.float = float;
        /** @type {!SingleTypeCoder} */
        this.vec2 = vec2;
        /** @type {!SingleTypeCoder} */
        this.vec4 = vec4;
    }
}

/**
 * @param {!string} name
 * @returns {!ShaderPart}
 */
function boolInputPartGetter(name) {
    let pre = `_gen_${name}`;
    return new ShaderPart(`
        ///////////// boolInput(${name}) ////////////
        uniform sampler2D ${pre}_tex;
        uniform vec2 ${pre}_size;

        float read_${name}(float k) {
            vec2 uv = vec2(mod(k, ${pre}_size.x) + 0.5,
                           floor(k / ${pre}_size.x) + 0.5) / ${pre}_size;
            return float(texture2D(${pre}_tex, uv).x == 1.0);
        }

        float len_${name}() {
            return ${pre}_size.x * ${pre}_size.y * 4.0;
        }`,
        [],
        texture => [
            WglArg.texture(`${pre}_tex`, texture),
            WglArg.vec2(`${pre}_size`, texture.width, texture.height)
        ]);
}

const BOOL_OUTPUT_PART = new ShaderPart(`
    ///////////// BOOL_OUTPUT_AS_FLOAT ////////////
    bool outputFor(float k);

    uniform vec2 _gen_output_size;
    uniform float _gen_secret_half;

    float len_output() {
        return _gen_output_size.x * _gen_output_size.y;
    }

    void main() {
        vec2 xy = gl_FragCoord.xy - vec2(_gen_secret_half, _gen_secret_half);
        float k = xy.y * _gen_output_size.x + xy.x;
        gl_FragColor = vec4(float(outputFor(k)), 0.0, 0.0, 0.0);
    }`,
    [],
    texture => [
        WglArg.vec2('_gen_output_size', texture.width, texture.height),
        WglArg.float('_gen_secret_half', 0.5)
    ]);

const BOOL_TYPE_CODER = new SingleTypeCoder(
    boolInputPartGetter,
    BOOL_OUTPUT_PART,
    0,
    WebGLRenderingContext.UNSIGNED_BYTE,
    e => e,
    e => e,
    false);

export {SingleTypeCoder, ShaderCoder, ShaderPart, BOOL_TYPE_CODER}
