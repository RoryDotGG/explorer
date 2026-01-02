const test = require("node:test");
const assert = require("node:assert/strict");

const explorer = require("../explorer.js");
const state = explorer._state;

test("getResourceTypeFromImgSrc matches resource icons", () => {
    assert.equal(
        explorer.getResourceTypeFromImgSrc("https://colonist.io/dist/images/card_grain.svg"),
        "wheat"
    );
    assert.equal(
        explorer.getResourceTypeFromImgSrc("/assets/card_ore.svg"),
        "stone"
    );
    assert.equal(
        explorer.getResourceTypeFromImgSrc("/assets/card_wool.svg"),
        "sheep"
    );
    assert.equal(
        explorer.getResourceTypeFromImgSrc("/assets/card_brick.svg"),
        "brick"
    );
    assert.equal(
        explorer.getResourceTypeFromImgSrc("/assets/card_lumber.svg"),
        "wood"
    );
    assert.equal(explorer.getResourceTypeFromImgSrc("/assets/unknown.svg"), null);
});

test("canAffordWithMinimums and getBuildOptions behave as expected", () => {
    const minResources = {
        wood: 1,
        brick: 1,
        sheep: 1,
        wheat: 2,
        stone: 3,
    };

    assert.equal(
        explorer.canAffordWithMinimums(minResources, { wood: 1, brick: 1 }),
        true
    );

    const options = explorer.getBuildOptions(minResources);
    assert.deepEqual(options.sort(), ["city", "dev", "road", "settlement"].sort());
});

test("parseStolenPlayers extracts stealing and target players", () => {
    const element = {
        textContent: "Alice stole  from: Bob",
    };
    assert.deepEqual(explorer.parseStolenPlayers(element), {
        stealingPlayer: "Alice",
        targetPlayer: "Bob",
    });
});

test("calculateTheftForPlayerAndResource totals theft deltas", () => {
    state.thefts.length = 0;
    state.thefts.push({
        who: { stealingPlayer: "Alice", targetPlayer: "Bob" },
        what: { wood: 1, brick: 1 },
    });
    state.thefts.push({
        who: { stealingPlayer: "Bob", targetPlayer: "Alice" },
        what: { wheat: 1 },
    });

    assert.equal(explorer.calculateTheftForPlayerAndResource("Alice", "wood"), 1);
    assert.equal(explorer.calculateTheftForPlayerAndResource("Bob", "wood"), -1);
    assert.equal(explorer.calculateTheftForPlayerAndResource("Alice", "wheat"), -1);
});
