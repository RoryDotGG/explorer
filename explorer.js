
console.log("STARTED...");

var logElement;
var initialPlacementMade = false;
var initialPlacementDoneMessage = "Giving out starting resources";
var placeInitialSettlementSnippet = "turn to place";
var receivedResourcesSnippet = "got:";
var builtSnippet = "built a";
var boughtSnippet = " bought ";
var tradeBankGaveSnippet = "gave bank:";
var tradeBankTookSnippet = "and took";
var stoleAllOfSnippet = "stole all of";
var discardedSnippet = "discarded";
var tradedWithSnippet = " traded with: ";
var tradeWantsToGiveSnippet = "wants to give:";
var tradeGiveForSnippet = "for:";
var stoleFromYouSnippet = "stole:";
var stoleFromSnippet = " stole  from: "; // extra space from icon

var PERSISTENCE_PREFIX = "explorer_state_";
var persistTimer = null;

var HINTS_ENABLED = true;
var HAND_RISK_THRESHOLD = 7;

var wood = "wood";
var stone = "stone";
var wheat = "wheat";
var brick = "brick";
var sheep = "sheep";
var resourceTypes = [wood, stone, wheat, brick, sheep];

// Players
var players = [];
var player_colors = {}; // player -> hex

// Per player per resource
var resources = {};

// Message offset
var MSG_OFFSET = 0;

// Thefts - transactions from when the robber is placed and stolen resource is unknown 
var thefts = [];
// Thefts - once the unknown resources are accounted for
var solved_thefts = [];


// First, delete the discord signs
function deleteDiscordSigns() {
    var allPageImages = document.getElementsByTagName('img'); 
    for (var i = 0; i < allPageImages.length; i++) {
        if (allPageImages[i].src.includes("discord")) {
            allPageImages[i].remove();
        }
    }
    var ad_left = document.getElementById("in-game-ad-left");
    if (ad_left) {
        ad_left.remove();
    }
    var ad_right = document.getElementById("in-game-ad-right");
    if (ad_right) {
        ad_right.remove();
    }
}

/**
 * Calculate the total lost quantity of a resource for a given player. 
 * i.e. if 1 card was potentially stolen, return 1.
 */
function calculateTheftForPlayerAndResource(player, resourceType) {
    return thefts.map(theft => {
        if (theft.who.stealingPlayer === player) {
            return theft.what[resourceType] || 0;
        }
        if (theft.who.targetPlayer === player) {
            return -theft.what[resourceType] || 0;
        }
        return 0;
    }).reduce((a, b) => a + b, 0);
}

function getUnknownTheftSummary(player) {
    var summary = {
        pending: 0,
        netDelta: 0,
        minResources: {},
    };
    for (var resourceType of resourceTypes) {
        summary.minResources[resourceType] = resources[player][resourceType];
    }
    for (var i = 0; i < thefts.length; i++) {
        var theft = thefts[i];
        if (theft.who.targetPlayer === player) {
            summary.pending += 1;
            summary.netDelta -= 1;
            for (var resourceType in theft.what) {
                summary.minResources[resourceType] -= 1;
            }
        }
        if (theft.who.stealingPlayer === player) {
            summary.pending += 1;
            summary.netDelta += 1;
        }
    }
    return summary;
}

function getPlayerHandEstimate(player, netDelta) {
    var total = 0;
    for (var resourceType of resourceTypes) {
        total += resources[player][resourceType];
    }
    return total + netDelta;
}

function canAffordWithMinimums(minResources, costs) {
    for (var resourceType in costs) {
        if ((minResources[resourceType] || 0) < costs[resourceType]) {
            return false;
        }
    }
    return true;
}

function getBuildOptions(minResources) {
    var options = [];
    if (canAffordWithMinimums(minResources, { [wood]: 1, [brick]: 1 })) {
        options.push("road");
    }
    if (canAffordWithMinimums(minResources, { [wood]: 1, [brick]: 1, [sheep]: 1, [wheat]: 1 })) {
        options.push("settlement");
    }
    if (canAffordWithMinimums(minResources, { [stone]: 3, [wheat]: 2 })) {
        options.push("city");
    }
    if (canAffordWithMinimums(minResources, { [sheep]: 1, [wheat]: 1, [stone]: 1 })) {
        options.push("dev");
    }
    return options;
}

function getResourceImg(resourceType) {
    var img_name = "";
    switch (resourceType) {
        case wheat:
            img_name = "card_grain";
            break;
        case stone:
            img_name = "card_ore";
            break;
        case sheep:
            img_name = "card_wool";
            break;
        case brick:
            img_name = "card_brick";
            break;
        case wood:
            img_name = "card_lumber";
            break;
    }
    if (!img_name.length) throw Error("Couldn't find resource image icon");
    return `<img src="https://colonist.io/dist/images/${img_name}.svg" class="explorer-tbl-resource-icon" />`
}

function getResourceTypeFromImgSrc(src) {
    if (src.includes("card_wool")) {
        return sheep;
    }
    if (src.includes("card_lumber")) {
        return wood;
    }
    if (src.includes("card_brick")) {
        return brick;
    }
    if (src.includes("card_ore")) {
        return stone;
    }
    if (src.includes("card_grain")) {
        return wheat;
    }
    return null;
}

function applyResourceDelta(player, resourceType, delta) {
    if (!resourceType) {
        return;
    }
    resources[player][resourceType] += delta;
}

function applyResourceDeltaFromImg(player, img, delta) {
    applyResourceDelta(player, getResourceTypeFromImgSrc(img.src), delta);
}

function applyResourceDeltasFromHtml(player, htmlSegment, delta) {
    var imgChunks = htmlSegment.split("<img");
    for (var i = 0; i < imgChunks.length; i++) {
        applyResourceDelta(player, getResourceTypeFromImgSrc(imgChunks[i]), delta);
    }
}

function transferResourcesFromHtml(srcPlayer, destPlayer, htmlSegment) {
    var imgChunks = htmlSegment.split("<img");
    for (var i = 0; i < imgChunks.length; i++) {
        var resourceType = getResourceTypeFromImgSrc(imgChunks[i]);
        if (resourceType) {
            transferResource(srcPlayer, destPlayer, resourceType);
        }
    }
}

function parseStolenPlayers(prevElement) {
    if (!prevElement) {
        return null;
    }
    var parts = prevElement.textContent.replace(stoleFromSnippet, " ").split(" ").filter(Boolean);
    if (parts.length < 2) {
        return null;
    }
    return {
        stealingPlayer: parts[0],
        targetPlayer: parts[1],
    };
}

function renderPlayerCell(player) {
    return `
        <div class="explorer-tbl-player-col-cell-color" style="background-color:${player_colors[player]}"></div>
        <span class="explorer-tbl-player-name" style="color:${player_colors[player]}">${player}</span>
    `;
}

function renderHintsPanel() {
    var existingHints = document.getElementById("explorer-hints");
    if (existingHints) {
        existingHints.remove();
    }
    if (!HINTS_ENABLED) {
        return;
    }
    var body = document.getElementsByTagName("body")[0];
    var container = document.createElement("div");
    container.id = "explorer-hints";

    var title = document.createElement("div");
    title.className = "explorer-hints-title";
    title.textContent = "Hints";
    container.appendChild(title);

    for (var i = 0; i < players.length; i++) {
        var player = players[i];
        if (!resources[player]) {
            continue;
        }
        var summary = getUnknownTheftSummary(player);
        var buildOptions = getBuildOptions(summary.minResources);
        var handEstimate = getPlayerHandEstimate(player, summary.netDelta);
        var hints = [];

        if (buildOptions.length) {
            hints.push("Can build now: " + buildOptions.join(", "));
        }
        if (handEstimate >= HAND_RISK_THRESHOLD) {
            hints.push("Hand size risk: 7+ (est. " + handEstimate + ")");
        }
        if (summary.pending > 0) {
            hints.push("Unknown thefts pending: " + summary.pending);
        }
        if (!hints.length) {
            hints.push("No immediate hints");
        }

        var row = document.createElement("div");
        row.className = "explorer-hints-row";

        var playerCol = document.createElement("div");
        playerCol.className = "explorer-hints-player";
        var playerColor = document.createElement("div");
        playerColor.className = "explorer-hints-player-color";
        playerColor.style.backgroundColor = player_colors[player];
        var playerName = document.createElement("span");
        playerName.className = "explorer-hints-player-name";
        playerName.style.color = player_colors[player];
        playerName.textContent = player;
        playerCol.appendChild(playerColor);
        playerCol.appendChild(playerName);

        var hintText = document.createElement("div");
        hintText.className = "explorer-hints-text";
        hintText.textContent = hints.join(" | ");

        row.appendChild(playerCol);
        row.appendChild(hintText);
        container.appendChild(row);
    }

    body.appendChild(container);
}

function getFingerprintId() {
    var hash = window.location.hash || "";
    if (!hash) {
        return null;
    }
    return hash.replace(/^#/, "");
}

function getPersistenceKey() {
    var fingerprint = getFingerprintId();
    if (!fingerprint) {
        return null;
    }
    return `${PERSISTENCE_PREFIX}${fingerprint}`;
}

function savePersistedState() {
    var key = getPersistenceKey();
    if (!key) {
        return;
    }
    var payload = {
        players,
        player_colors,
        resources,
        thefts,
        solved_thefts,
    };
    localStorage.setItem(key, JSON.stringify(payload));
}

function schedulePersistedState() {
    if (persistTimer) {
        clearTimeout(persistTimer);
    }
    persistTimer = setTimeout(() => {
        persistTimer = null;
        savePersistedState();
    }, 250);
}

function loadPersistedState() {
    var key = getPersistenceKey();
    if (!key) {
        return false;
    }
    var raw = localStorage.getItem(key);
    if (!raw) {
        return false;
    }
    try {
        var payload = JSON.parse(raw);
        players = payload.players || [];
        player_colors = payload.player_colors || {};
        resources = payload.resources || {};
        thefts = payload.thefts || [];
        solved_thefts = payload.solved_thefts || [];
        return true;
    } catch (e) {
        console.warn("Failed to parse persisted state", e);
        return false;
    }
}

/**
* Renders the table with the counts.
*/
function render() {
    var existingTbl = document.getElementById("explorer-tbl");
    try {
        if (existingTbl) {
            existingTbl.remove();
        }
    } catch (e) {
        console.warn("had an issue deleting the table", e);
    }
    var body = document.getElementsByTagName("body")[0];
    var tbl = document.createElement("table");
    tbl.setAttribute("cellspacing", 0);
    tbl.setAttribute("cellpadding", 0);
    tbl.id = "explorer-tbl";
    
    // Header row - one column per resource, plus player column
    var header = tbl.createTHead();
    header.className = "explorer-tbl-header";
    var headerRow = header.insertRow(0);
    var playerHeaderCell = headerRow.insertCell(0);
    playerHeaderCell.innerHTML = "Name";
    playerHeaderCell.className = "explorer-tbl-player-col-header";
    for (var i = 0; i < resourceTypes.length; i++) {
        var resourceType = resourceTypes[i];
        var resourceHeaderCell = headerRow.insertCell(i + 1);
        resourceHeaderCell.className = "explorer-tbl-cell";
        resourceHeaderCell.innerHTML = getResourceImg(resourceType);
    }
    
    var tblBody = tbl.createTBody();
    // Row per player
    for (var i = 0; i < players.length; i++) {
        var player = players[i];
        var row = tblBody.insertRow(i);
        row.className = "explorer-tbl-row";
        var playerRowCell = row.insertCell(0);
        playerRowCell.className = "explorer-tbl-player-col-cell";
        playerRowCell.innerHTML = renderPlayerCell(player);
        for (var j = 0; j < resourceTypes.length; j++) {
            var cell = row.insertCell(j + 1);
            cell.className = "explorer-tbl-cell";
            var resourceType = resourceTypes[j];
            var cellCount = resources[player][resourceType];
            var theftCount = calculateTheftForPlayerAndResource(player, resourceType);
            cell.innerHTML = theftCount === 0 
                ? "" + resources[player][resourceType] 
                : `${cellCount} (${cellCount + theftCount})`;
        }
    }

    // put <table> in the <body>
    body.appendChild(tbl);
    // tbl border attribute to 
    tbl.setAttribute("border", "2");
    renderHintsPanel();
    schedulePersistedState();
}

/**
* Process a "got resource" message: [user icon] [user] got: ...[resource images]
*/
function parseGotMessage(pElement) {
    var textContent = pElement.textContent;
    if (!textContent.includes(receivedResourcesSnippet)) {
        return;
    }
    var player = textContent.replace(receivedResourcesSnippet, "").split(" ")[0];
    if (!resources[player]) {
        console.log("Failed to parse player...", player, resources);
        return;
    }
    var images = collectionToArray(pElement.getElementsByTagName('img'));
    for (var img of images) {
        applyResourceDeltaFromImg(player, img, 1);
    }
}

/**
 * Process a "built" message: [user icon] [user] built a [building/road]
 */
function parseBuiltMessage(pElement) {
    var textContent = pElement.textContent;
    if (!textContent.includes(builtSnippet)) {
        return;
    }
    var images = collectionToArray(pElement.getElementsByTagName('img'));
    var player = textContent.split(" ")[0];
    if (!resources[player]) {
        console.log("Failed to parse player...", player, resources);
        return;
    }
    for (var img of images) {
        if (img.src.includes("road")) {
            resources[player][wood] -= 1;
            resources[player][brick] -= 1;
        } else if (img.src.includes("settlement")) {
            resources[player][wood] -= 1;
            resources[player][brick] -= 1;
            resources[player][sheep] -= 1;
            resources[player][wheat] -= 1;
        } else if (img.src.includes("city")) {
            resources[player][stone] -= 3;
            resources[player][wheat] -= 2;
        }
    }
}

/**
 * Process a "bought" message: [user icon] [user] built
 */
function parseBoughtMessage(pElement) {
    var textContent = pElement.textContent;
    if (!textContent.includes(boughtSnippet)) {
        return;
    }
    var images = collectionToArray(pElement.getElementsByTagName('img'));
    var player = textContent.split(" ")[0];
    if (!resources[player]) {
        console.log("Failed to parse player...", player, resources);
        return;
    }
    for (var img of images) {
        if (img.src.includes("card_devcardback")) {
            resources[player][sheep] -= 1;
            resources[player][wheat] -= 1;
            resources[player][stone] -= 1;
        }
    }
}

/**
 * Process a trade with the bank message: [user icon] [user] gave bank: ...[resources] and took ...[resources]
 */
function parseTradeBankMessage(pElement) {
    var textContent = pElement.textContent;
    if (!textContent.includes(tradeBankGaveSnippet)) {
        return;
    }
    var player = textContent.split(" ")[0];
    if (!resources[player]) {
        console.log("Failed to parse player...", player, resources);
        return;
    }
    // We have to split on the text, which isn't wrapped in tags, so we parse innerHTML, which prints the HTML and the text.
    var innerHTML = pElement.innerHTML;
    var gaveStart = innerHTML.indexOf(tradeBankGaveSnippet);
    var tookStart = innerHTML.indexOf(tradeBankTookSnippet);
    if (gaveStart === -1 || tookStart === -1) {
        return;
    }
    var gaveSegment = innerHTML.slice(gaveStart, tookStart);
    var tookSegment = innerHTML.slice(tookStart);
    applyResourceDeltasFromHtml(player, gaveSegment, -1);
    applyResourceDeltasFromHtml(player, tookSegment, 1);
}

function stealAllOfResource(receivingPlayer, resource) {
    for (var plyr of players) {
        if (plyr !== receivingPlayer) {
            resources[receivingPlayer][resource] += resources[plyr][resource];
            resources[plyr][resource] = 0;
        }
    }
}

/**
 * Parse monopoly card ("stole all of" some resource): [user] used [monopoly icon] & stole all of: [resource icon]
 */
function parseStoleAllOfMessage(pElement) {
    var textContent = pElement.textContent;
    if (!textContent.includes(stoleAllOfSnippet)) {
        return;
    }
    var player = textContent.split(" ")[0];
    if (!resources[player]) {
        console.log("Failed to parse player...", player, resources);
        return;
    }
    var images = collectionToArray(pElement.getElementsByTagName('img'));
    // there will only be 1 resource icon
    for (var img of images) {
        var resourceType = getResourceTypeFromImgSrc(img.src);
        if (resourceType) {
            stealAllOfResource(player, resourceType);
        }
    }
}

/**
 * When the user has to discard cards because of a robber.
 */
function parseDiscardedMessage(pElement) {
    var textContent = pElement.textContent;
    if (!textContent.includes(discardedSnippet)) {
        return;
    }
    var player = textContent.split(" ")[0];
    if (!resources[player]) {
        console.log("Failed to parse player...", player, resources);
        return;
    }
    var images = collectionToArray(pElement.getElementsByTagName('img'));
    for (var img of images) {
        applyResourceDeltaFromImg(player, img, -1);
    }
}

function transferResource(srcPlayer, destPlayer, resource, quantity = 1) {
    resources[srcPlayer][resource] -= quantity;
    resources[destPlayer][resource] += quantity;
}

/**
 * Message T-1: [user1] wants to give: ...[resources] for: ...[resources]
 * Message T: [user1] traded with: [user2]
 */
function parseTradedMessage(pElement, prevElement) {
    var textContent = pElement.textContent;
    if (!textContent.includes(tradedWithSnippet)) {
        return;
    }
    if (!prevElement) {
        return;
    }
    var tradingPlayer = textContent.split(tradedWithSnippet)[0];
    var agreeingPlayer = textContent.split(tradedWithSnippet)[1];
    if (!resources[tradingPlayer] || !resources[agreeingPlayer]) {
        console.log("Failed to parse player...", tradingPlayer, agreeingPlayer, pElement.textContent, prevElement.textContent, resources);
        return;
    }
    // We have to split on the text, which isn't wrapped in tags, so we parse innerHTML, which prints the HTML and the text.
    var innerHTML = prevElement.innerHTML; // on the trade description msg
    var wantsStart = innerHTML.indexOf(tradeWantsToGiveSnippet);
    var giveForStart = innerHTML.indexOf(tradeGiveForSnippet);
    if (wantsStart === -1 || giveForStart === -1) {
        return;
    }
    var wantsSegment = innerHTML.slice(wantsStart, giveForStart);
    var giveForSegment = innerHTML.slice(giveForStart);
    transferResourcesFromHtml(tradingPlayer, agreeingPlayer, wantsSegment);
    transferResourcesFromHtml(agreeingPlayer, tradingPlayer, giveForSegment);
}

/**
 * Message T-1: [stealingPlayer] stole [resource] from: [targetPlayer]
 * Message T: [stealingPlayer] stole: [resource]
 */
function parseStoleFromYouMessage(pElement, prevElement) {
    var textContent = pElement.textContent;
    if (!textContent.includes(stoleFromYouSnippet)) {
        return;
    }
    var parsedPlayers = parseStolenPlayers(prevElement);
    if (!parsedPlayers) {
        return;
    }
    var stealingPlayer = parsedPlayers.stealingPlayer;
    var targetPlayer = parsedPlayers.targetPlayer;
    if (!resources[stealingPlayer] || !resources[targetPlayer]) {
        console.log("Failed to parse player...", stealingPlayer, targetPlayer, resources);
        return;
    }
    var images = collectionToArray(pElement.getElementsByTagName('img'));
    for (var img of images) {
        var resourceType = getResourceTypeFromImgSrc(img.src);
        if (resourceType) {
            transferResource(targetPlayer, stealingPlayer, resourceType);
        }
    }
}

/**
 * Message T-1: [stealingPlayer] stole [resource] from: [targetPlayer]
 * Message T is NOT: [stealingPlayer] stole: [resource]
 */
function parseStoleUnknownMessage(pElement, prevElement) {
    if (!prevElement) {
        return;
    }
    var messageT = pElement.textContent;
    var messageTMinus1 = prevElement.textContent;
    var matches = !messageT.includes(stoleFromYouSnippet) && messageTMinus1.includes(stoleFromSnippet);
    if (!matches) {
        return;
    }
    // figure out the 2 players
    var parsedPlayers = parseStolenPlayers(prevElement);
    if (!parsedPlayers) {
        return;
    }
    var stealingPlayer = parsedPlayers.stealingPlayer;
    var targetPlayer = parsedPlayers.targetPlayer;
    if (!resources[stealingPlayer] || !resources[targetPlayer]) {
        console.log("Failed to parse player...", stealingPlayer, targetPlayer, resources);
        return;
    }
    // for the player being stolen from, (-1) on all resources that are non-zero
    // for the player receiving, (+1) for all resources that are non-zero FOR THE OTHER PLAYER
    // record the unknown and wait for it to surface
    var theft = {
        who: {
            stealingPlayer,
            targetPlayer,
        },
        what: {}
    };
    for (var resourceType of resourceTypes) {
        if (resources[targetPlayer][resourceType] > 0) {
            theft.what[resourceType] = 1;
        }
    }
    var resourceTypesPotentiallyStolen = Object.keys(theft.what);
    if (resourceTypesPotentiallyStolen.length === 0) {
        // nothing could have been stolen
        return;
    }
    if (resourceTypesPotentiallyStolen.length === 1) {
        // only 1 resource could have been stolen, so it's not an unknown
        transferResource(targetPlayer, stealingPlayer, resourceTypesPotentiallyStolen[0]);
    } else {
        // we can't be sure, so record the unknown
        thefts.push(theft);
    }
}

/**
 * See if thefts can be solved based on current resource count.
 * Rules:
 *  
 *  - if resource count < 0, then they spent a resource they stole (what if there are multiple thefts that could account for this?)
 *  - if resource count + theft count < 0, then we know that resource was stolen, and we can remove it from the list of potentials.
 *     - if there's only 1 resource left, we know what was stolen in another instance.
 */
function reviewThefts() {
    for (var player of players) {
        for (var resourceType of resourceTypes) {
            var resourceCount = resources[player][resourceType];
            var theftCount = calculateTheftForPlayerAndResource(player, resourceType);
            var total = resourceCount + theftCount;
            if (total < -1) {
                throw Error('Invalid state', resourceType, player, resourceCount, theftCount, resources);
            }
            // the player stole a resource and spent it
            if (resourceCount === -1 && total === 0) {
                for (var i = 0; i < thefts.length; i++) {
                    if (thefts[i].who.stealingPlayer === player && !!thefts[i].what[resourceType]) {
                        transferResource(thefts[i].who.targetPlayer, player, resourceType);
                        thefts[i].solved = true;
                    }
                }
            }
            // the player had a resource stolen and the stealer spent it (?)
            if (resourceCount === 0 && total === -1) {
                for (var i = 0; i < thefts.length; i++) {
                    if (thefts[i].who.targetPlayer === player && !!thefts[i].what[resourceType]) {
                        delete thefts[i].what[resourceType];
                        console.log("Theft possibilities reduced!", thefts[i], resourceType);
                        
                        var remainingResourcePossibilities = Object.keys(thefts[i].what);
                        if (remainingResourcePossibilities.length === 1) {
                            transferResource(
                                thefts[i].who.targetPlayer, 
                                thefts[i].who.stealingPlayer, 
                                remainingResourcePossibilities[0]
                            );
                            thefts[i].solved = true;
                            console.log("Theft solved!", thefts[i]);
                        }
                        break;
                    }
                }
            }
        }
    }
    // Remove if we can solve based on there being no resources of that type in play
    for (var resourceType of resourceTypes) {
        var resourceTotalInPlay = Object.values(resources).map(r => r[resourceType]).reduce((a, b) => a + b, 0);
        if (resourceTotalInPlay === 0) {
            for (var i = 0; i < thefts.length; i++) {
                if (thefts[i].solved) {
                    continue;
                }
                delete thefts[i].what[resourceType];
                var remainingOptions = Object.keys(thefts[i].what);
                if (remainingOptions.length === 1) {
                    transferResource(
                        thefts[i].who.targetPlayer, 
                        thefts[i].who.stealingPlayer, 
                        remainingOptions[0]
                    );
                    thefts[i].solved = true;
                }
            }
        }
    }
    // Removed any solved thefts.
    solved_thefts = solved_thefts.concat(thefts.filter(t => t.solved));
    thefts = thefts.filter(t => !t.solved);
}

var ALL_PARSERS = [
    parseGotMessage,
    parseBuiltMessage,
    parseBoughtMessage,
    parseTradeBankMessage,
    parseStoleAllOfMessage,
    parseDiscardedMessage,
    parseTradedMessage,
    parseStoleFromYouMessage,
    parseStoleUnknownMessage,
];

/**
 * Parses the latest messages and re-renders the table.
 */
function parseLatestMessages() {
    var allMessages = getAllMessages();
    var newOffset = allMessages.length;
    var newMessages = allMessages.slice(MSG_OFFSET);
    if (!newMessages.length) {
        return;
    }
    ALL_PARSERS.forEach(parser => newMessages.forEach((msg, idx) => {
        var prevMessage = idx > 0 ? newMessages[idx - 1] : allMessages[MSG_OFFSET - 1];
        parser(msg, prevMessage);
    }));
    MSG_OFFSET = newOffset;
    reviewThefts();
    render();
}

function startWatchingMessages() {
    setInterval(parseLatestMessages, 500);
}

/**
* Log initial resource distributions.
*/
function tallyInitialResources() {
    var allMessages = getAllMessages();
    MSG_OFFSET = allMessages.length;
    allMessages.forEach(parseGotMessage);
    deleteDiscordSigns();
    render();
    deleteDiscordSigns(); // idk why but it takes 2 runs to delete both signs
    startWatchingMessages();
}

/**
* Once initial settlements are placed, determine the players.
*/
function recognizeUsers() {
    var placementMessages = getAllMessages()
    .filter(msg => msg.textContent.includes(placeInitialSettlementSnippet));
    console.log("total placement messages", placementMessages.length);
    for (var msg of placementMessages) {
        var msg_text = msg.textContent;
        var username = msg_text.replace(placeInitialSettlementSnippet, "").split(" ")[0];
        console.log(username);
        if (!resources[username]) {
            players.push(username);
            player_colors[username] = msg.style.color;
            resources[username] = {
                [wood]: 0,
                [stone]: 0,
                [wheat]: 0,
                [brick]: 0,
                [sheep]: 0,
            };
        }
    }
}

function clearResources() {
    for (var player of players) {
        resources[player] = {};
        for (var resourceType of resourceTypes) {
            resources[player][resourceType] = 0;
        }
    }
}

function loadCounter() {
    setTimeout(() => {
        recognizeUsers();
        tallyInitialResources();
    }, 500); // wait for inital resource distribution to be logged
}

function getAllMessages() {
    if (!logElement) {
        throw Error("Log element hasn't been found yet.");
    }
    return collectionToArray(logElement.children);
}

function collectionToArray(collection) {
    return Array.prototype.slice.call(collection);
}

/**
* Wait for players to place initial settlements so we can determine who the players are.
*/
function waitForInitialPlacement() {
    var interval = setInterval(() => {
        if (initialPlacementMade) {
            clearInterval(interval);
            loadCounter();
        } else {
            var messages = Array.prototype.slice.call(logElement.children).map(p => p.textContent);
            if (messages.some(m => m === initialPlacementDoneMessage)) {
                initialPlacementMade = true;
            }
        }
    }, 500);
}

/**
* Find the transcription.
*/
function findTranscription() {
    var interval = setInterval(() => {
        if (logElement) {
            console.log("Logs loaded...");
            clearInterval(interval);
            if (loadPersistedState()) {
                MSG_OFFSET = getAllMessages().length;
                render();
                deleteDiscordSigns();
                startWatchingMessages();
            } else {
                waitForInitialPlacement();
            }
        } else {
            logElement = document.getElementById("game-log-text");
        }
    }, 500);
}


function shouldAutoStart() {
    return typeof window !== "undefined" && typeof document !== "undefined";
}

if (shouldAutoStart()) {
    findTranscription();
}

if (typeof module !== "undefined" && module.exports) {
    module.exports = {
        calculateTheftForPlayerAndResource,
        canAffordWithMinimums,
        getBuildOptions,
        getResourceTypeFromImgSrc,
        parseStolenPlayers,
        _state: {
            resources,
            thefts,
            players,
            resourceTypes,
        },
    };
}
