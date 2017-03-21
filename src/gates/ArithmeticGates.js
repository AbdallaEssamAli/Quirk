import {Gate} from "src/circuit/Gate.js"
import {GatePainting} from "src/draw/GatePainting.js"
import {ketArgs, ketShaderPermute} from "src/circuit/KetShaderUtil.js"
import {Matrix} from "src/math/Matrix.js"
import {WglArg} from "src/webgl/WglArg.js"
import {WglConfiguredShader} from "src/webgl/WglConfiguredShader.js"

let ArithmeticGates = {};

const makeOffsetMatrix = (offset, qubitSpan) =>
    Matrix.generateTransition(1<<qubitSpan, e => (e + offset) & ((1<<qubitSpan)-1));

const INCREMENT_MATRIX_MAKER = span => makeOffsetMatrix(1, span);
const DECREMENT_MATRIX_MAKER = span => makeOffsetMatrix(-1, span);
const ADDITION_MATRIX_MAKER = span => Matrix.generateTransition(1<<span, e => {
    let sa = Math.floor(span/2);
    let sb = Math.ceil(span/2);
    let a = e & ((1 << sa) - 1);
    let b = e >> sa;
    b += a;
    b &= ((1 << sb) - 1);
    return a + (b << sa);
});
const SUBTRACTION_MATRIX_MAKER = span => Matrix.generateTransition(1<<span, e => {
    let sa = Math.floor(span/2);
    let sb = Math.ceil(span/2);
    let a = e & ((1 << sa) - 1);
    let b = e >> sa;
    b -= a;
    b &= ((1 << sb) - 1);
    return a + (b << sa);
});

/**
 * @param {!CircuitEvalContext} ctx
 * @param {!int} qubitSpan
 * @param {!int} incrementAmount
 * @returns {!WglConfiguredShader}
 */
const incrementShaderFunc = (ctx, qubitSpan, incrementAmount) =>
    incrementShader.withArgs(
        ...ketArgs(ctx, qubitSpan),
        WglArg.float("amount", incrementAmount));
const incrementShader = ketShaderPermute(
    'uniform float amount;',
    'return mod(out_id - amount + span, span);');

function flipShaderFunc(ctx, span, srcOffset, srcSpan) {
    return FLIP_SHADER.withArgs(
        ...ketArgs(ctx, span),
        WglArg.float("srcOffset", 1 << srcOffset),
        WglArg.float("srcSpan", 1 << srcSpan));
}
const FLIP_SHADER = ketShaderPermute(
    'uniform float srcOffset, srcSpan;',
    `
        float d = mod(floor(full_out_id / srcOffset), srcSpan);
        return out_id >= d ? out_id : mod(d - 1.0 - out_id, span);`);

function flipShaderFunc2(ctx, span, srcOffset, srcSpan) {
    return FLIP_SHADER_2.withArgs(
        ...ketArgs(ctx, span),
        WglArg.float("srcOffset", 1 << srcOffset),
        WglArg.float("srcSpan", 1 << srcSpan));
}
const FLIP_SHADER_2 = ketShaderPermute(
    'uniform float srcOffset, srcSpan;',
    `
        float d = mod(floor(full_out_id / srcOffset), srcSpan);
        return out_id > d ? out_id : mod(d - out_id, span);`);

function additionShaderFunc(ctx, span, srcOffset, srcSpan, scaleFactor) {
    return ADDITION_SHADER.withArgs(
        ...ketArgs(ctx, span),
        WglArg.float("srcOffset", 1 << srcOffset),
        WglArg.float("srcSpan", 1 << srcSpan),
        WglArg.float("factor", scaleFactor));
}
const ADDITION_SHADER = ketShaderPermute(
    'uniform float srcOffset, srcSpan, factor;',
    `
        float d = mod(floor(full_out_id / srcOffset), srcSpan);
        d *= factor;
        d = mod(d, span);
        return mod(out_id + span - d, span);`);

/**
 * @param {!string} compareCode
 * @returns {!WglConfiguredShader}
 */
function customComparisonShader(compareCode) {
    const shader = ketShaderPermute(
        'uniform float lhsOffset, lhsSpan, rhsOffset, rhsSpan;',
        `
            float lhs = mod(floor(full_out_id / lhsOffset), lhsSpan);
            float rhs = mod(floor(full_out_id / rhsOffset), rhsSpan);
            return mod(out_id + ((${compareCode}) ? 1.0 : 0.0), 2.0);`);

    return ctx => {
        let {offset: lhsOffset, length: lhsSpan} = ctx.customContextFromGates.get('Input Range A');
        let {offset: rhsOffset, length: rhsSpan} = ctx.customContextFromGates.get('Input Range B');
        return shader.withArgs(
            ...ketArgs(ctx, 1),
            WglArg.float("lhsOffset", 1 << lhsOffset),
            WglArg.float("rhsOffset", 1 << rhsOffset),
            WglArg.float("lhsSpan", 1 << lhsSpan),
            WglArg.float("rhsSpan", 1 << rhsSpan));
    };
}

ArithmeticGates.IncrementFamily = Gate.generateFamily(1, 16, span => Gate.withoutKnownMatrix(
    "++",
    "Increment Gate",
    "Adds 1 to the little-endian number represented by a block of qubits.").
    markedAsOnlyPermutingAndPhasing().
    markedAsStable().
    withKnownMatrix(span >= 4 ? undefined : INCREMENT_MATRIX_MAKER(span)).
    withSerializedId("inc" + span).
    withHeight(span).
    withCustomShader(ctx => incrementShaderFunc(ctx, span, +1)));

ArithmeticGates.DecrementFamily = Gate.generateFamily(1, 16, span => Gate.withoutKnownMatrix(
    "- -",
    "Decrement Gate",
    "Subtracts 1 from the little-endian number represented by a block of qubits.").
    markedAsOnlyPermutingAndPhasing().
    markedAsStable().
    withKnownMatrix(span >= 4 ? undefined : DECREMENT_MATRIX_MAKER(span)).
    withSerializedId("dec" + span).
    withHeight(span).
    withCustomShader(ctx => incrementShaderFunc(ctx, span, -1)));

ArithmeticGates.AdditionFamily = Gate.generateFamily(2, 16, span => Gate.withoutKnownMatrix(
    "b+=a",
    "Addition Gate",
    "Adds a little-endian number into another.").
    markedAsOnlyPermutingAndPhasing().
    markedAsStable().
    withKnownMatrix(span >= 5 ? undefined : ADDITION_MATRIX_MAKER(span)).
    withSerializedId("add" + span).
    withCustomDrawer(GatePainting.SECTIONED_DRAWER_MAKER(["a", "b+=a"], [Math.floor(span/2) / span])).
    withHeight(span).
    withCustomShader(ctx => additionShaderFunc(
        ctx.withRow(ctx.row + Math.floor(span/2)),
        Math.ceil(span/2),
        ctx.row,
        Math.floor(span/2),
        +1)));

ArithmeticGates.SubtractionFamily = Gate.generateFamily(2, 16, span => Gate.withoutKnownMatrix(
    "b-=a",
    "Subtraction Gate",
    "Subtracts a little-endian number from another.").
    markedAsOnlyPermutingAndPhasing().
    markedAsStable().
    withKnownMatrix(span >= 5 ? undefined : SUBTRACTION_MATRIX_MAKER(span)).
    withSerializedId("sub" + span).
    withCustomDrawer(GatePainting.SECTIONED_DRAWER_MAKER(["a", "b-=a"], [Math.floor(span/2) / span])).
    withHeight(span).
    withCustomShader(ctx => additionShaderFunc(
        ctx.withRow(ctx.row + Math.floor(span/2)),
        Math.ceil(span/2),
        ctx.row,
        Math.floor(span/2),
        -1)));

ArithmeticGates.PlusAFamily = Gate.generateFamily(1, 16, span => Gate.withoutKnownMatrix(
    "+A",
    "Addition Gate [input A]",
    "Adds 'input A' into the qubits covered by this gate.").
    markedAsOnlyPermutingAndPhasing().
    markedAsStable().
    withHeight(span).
    withSerializedId("+=A" + span).
    withRequiredContextKeys("Input Range A").
    withCustomShader(ctx => {
        let {offset: inputOffset, length: inputLength} = ctx.customContextFromGates.get('Input Range A');
        return additionShaderFunc(ctx, span, inputOffset, inputLength, +1);
    }));

ArithmeticGates.MinusAFamily = Gate.generateFamily(1, 16, span => Gate.withoutKnownMatrix(
    "−A",
    "Subtraction Gate [input A]",
    "Subtracts 'input A' out of the qubits covered by this gate.").
    markedAsOnlyPermutingAndPhasing().
    markedAsStable().
    withHeight(span).
    withSerializedId("-=A" + span).
    withRequiredContextKeys("Input Range A").
    withCustomShader(ctx => {
        let {offset: inputOffset, length: inputLength} = ctx.customContextFromGates.get('Input Range A');
        return additionShaderFunc(ctx, span, inputOffset, inputLength, -1);
    }));

ArithmeticGates.FlipBelow = Gate.generateFamily(1, 16, span => Gate.withoutKnownMatrix(
    "Flip<A",
    "Flip Gate [input A]",
    "?????").
    markedAsOnlyPermutingAndPhasing().
    markedAsStable().
    withHeight(span).
    withSerializedId("Flip<A" + span).
    withRequiredContextKeys("Input Range A").
    withCustomShader(ctx => {
        let {offset: inputOffset, length: inputLength} = ctx.customContextFromGates.get('Input Range A');
        return flipShaderFunc(ctx, span, inputOffset, inputLength);
    }));

ArithmeticGates.FlipBelow2 = Gate.generateFamily(1, 16, span => Gate.withoutKnownMatrix(
    "Flip≤A",
    "Flip Gate [input A]",
    "?????").
    markedAsOnlyPermutingAndPhasing().
    markedAsStable().
    withHeight(span).
    withSerializedId("Flip<=A" + span).
    withRequiredContextKeys("Input Range A").
    withCustomShader(ctx => {
        let {offset: inputOffset, length: inputLength} = ctx.customContextFromGates.get('Input Range A');
        return flipShaderFunc2(ctx, span, inputOffset, inputLength);
    }));

ArithmeticGates.ALessThanB = Gate.withoutKnownMatrix(
    "⊕A<B",
    "Less-Than Gate [inputs A, B]",
    "Toggles the target if 'input A' is less than 'input B'.").
    markedAsOnlyPermutingAndPhasing().
    markedAsStable().
    withSerializedId("^A<B").
    withRequiredContextKeys("Input Range A", "Input Range B").
    withCustomShader(customComparisonShader('lhs < rhs'));

ArithmeticGates.AGreaterThanB = Gate.withoutKnownMatrix(
    "⊕A>B",
    "Greater-Than Gate [inputs A, B]",
    "Toggles the target if 'input A' is greater than 'input B'.").
    markedAsOnlyPermutingAndPhasing().
    markedAsStable().
    withSerializedId("^A>B").
    withRequiredContextKeys("Input Range A", "Input Range B").
    withCustomShader(customComparisonShader('lhs > rhs'));

ArithmeticGates.ALessThanOrEqualToB = Gate.withoutKnownMatrix(
    "⊕A≤B",
    "At-Most Gate [inputs A, B]",
    "Toggles the target if 'input A' is less than 'input B'.").
    markedAsOnlyPermutingAndPhasing().
    markedAsStable().
    withSerializedId("^A<=B").
    withRequiredContextKeys("Input Range A", "Input Range B").
    withCustomShader(customComparisonShader('lhs <= rhs'));

ArithmeticGates.AGreaterThanOrEqualToB = Gate.withoutKnownMatrix(
    "⊕A≥B",
    "At-Least Gate [inputs A, B]",
    "Toggles the target if 'input A' is greater than 'input B'.").
    markedAsOnlyPermutingAndPhasing().
    markedAsStable().
    withSerializedId("^A>=B").
    withRequiredContextKeys("Input Range A", "Input Range B").
    withCustomShader(customComparisonShader('lhs >= rhs'));

ArithmeticGates.AEqualToB = Gate.withoutKnownMatrix(
    "⊕A=B",
    "Equality Gate [inputs A, B]",
    "Toggles the target if 'input A' is equal to 'input B'.").
    markedAsOnlyPermutingAndPhasing().
    markedAsStable().
    withSerializedId("^A=B").
    withRequiredContextKeys("Input Range A", "Input Range B").
    withCustomShader(customComparisonShader('lhs == rhs'));

ArithmeticGates.ANotEqualToB = Gate.withoutKnownMatrix(
    "⊕A≠B",
    "Inequality Gate [inputs A, B]",
    "Toggles the target if 'input A' is equal to 'input B'.").
    markedAsOnlyPermutingAndPhasing().
    markedAsStable().
    withSerializedId("^A!=B").
    withRequiredContextKeys("Input Range A", "Input Range B").
    withCustomShader(customComparisonShader('lhs != rhs'));

ArithmeticGates.all = [
    ...ArithmeticGates.IncrementFamily.all,
    ...ArithmeticGates.DecrementFamily.all,
    ...ArithmeticGates.AdditionFamily.all,
    ...ArithmeticGates.SubtractionFamily.all,
    ...ArithmeticGates.PlusAFamily.all,
    ...ArithmeticGates.MinusAFamily.all,
    ...ArithmeticGates.FlipBelow.all,
    ...ArithmeticGates.FlipBelow2.all,

    ArithmeticGates.ALessThanB,
    ArithmeticGates.AGreaterThanB,
    ArithmeticGates.AEqualToB,
    ArithmeticGates.ANotEqualToB,
    ArithmeticGates.ALessThanOrEqualToB,
    ArithmeticGates.AGreaterThanOrEqualToB,
];

export {ArithmeticGates, makeOffsetMatrix, incrementShaderFunc, additionShaderFunc}
