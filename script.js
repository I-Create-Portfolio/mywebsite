class SimpleMasonry extends HTMLElement {
    #columnCount = null;
    #elementHeights = [];
    #columnHeightsTracker = [];
    #mutationObserver;
    #debounceTimeout;
    #boundHandleResize;
    #width;
    #isTouch;

    #config = {
        baseColumnWidth: 250,
        densePlacement: true,
        animateOnResize: false,
        observeMutations: true,
        animationDuration: 300,
        useColumnCount: false,
        gapHorizontal: 10,
        gapVertical: 10
    };

    constructor() {
        super();
        this.#isTouch = navigator.maxTouchPoints > 0 || window.matchMedia?.("(pointer: coarse)").matches;
        this.#boundHandleResize = this.#handleResize.bind(this);
    }

    static get observedAttributes() {
        return [
            "data-base-column-width",
            "data-dense-placement",
            "data-gap-horizontal",
            "data-gap-vertical",
            "data-animation-duration",
            "data-use-column-count"
        ];
    }

    attributeChangedCallback(name, oldValue, newValue) {
        if (oldValue === newValue) return;

        if (this.isConnected) {
            this.#width = this.clientWidth || this.getBoundingClientRect().width;
            this.#readAttributes();
            this.#applyMasonryLayout(false, true);
        }
    }

    connectedCallback() {
        this.#readAttributes();
        this.#initializeObservers();

        // Force setting width before applying layout
        this.#width = this.clientWidth || this.getBoundingClientRect().width;

        // Ensure the layout runs after width is properly initialized
        requestAnimationFrame(() => {
            this.#applyMasonryLayout();
        });
    }

    disconnectedCallback() {
        this.destroy();
    }

    #readAttributes() {
        const attrs = {
            baseColumnWidth: "data-base-column-width",
            densePlacement: "data-dense-placement",
            animateOnResize: "data-animate-on-resize",
            observeMutations: "data-observe-mutations",
            animationDuration: "data-animation-duration",
            useColumnCount: "data-use-column-count",
            gapHorizontal: "data-gap-horizontal",
            gapVertical: "data-gap-vertical"
        };

        for (const [key, attr] of Object.entries(attrs)) {
            const value = this.getAttribute(attr);
            if (value !== null) {
                this.#config[key] = this.#parseAttribute(key, value);
            }
        }
    }

    #parseAttribute(key, value) {
        if (["baseColumnWidth", "animationDuration"].includes(key)) {
            return parseInt(value, 10);
        }

        if (["gapHorizontal", "gapVertical"].includes(key)) {
            return value.startsWith("--") ? value : parseInt(value, 10);
        }

        if (key === "useColumnCount") {
            return value.startsWith("--") ? value : value === "true";
        }

        return value === "true";
    }

    #initializeObservers() {
        if (this.#isTouch) {
            window.addEventListener("orientationchange", this.#boundHandleResize);
        } else {
            window.addEventListener("resize", this.#boundHandleResize);
        }

        if (this.#config.observeMutations && !this.#mutationObserver) {
            this.#mutationObserver = new MutationObserver(this.#handleMutations.bind(this));
            this.#mutationObserver.observe(this, { childList: true });
        }
    }

    #handleResize() {
        if (this.#isTouch) {
            this.#debouncedTouchResize();
        } else {
            if (this.#debounceTimeout) cancelAnimationFrame(this.#debounceTimeout);
            this.#debounceTimeout = requestAnimationFrame(() => {
                if (this.clientWidth !== this.#width) {
                    this.#applyMasonryLayout(true);
                }
            });
        }
    }

    #debouncedTouchResize() {
        if (this.#debounceTimeout) clearTimeout(this.#debounceTimeout);

        let startWidth = window.visualViewport?.width || window.innerWidth;
        let attempts = 0;

        const checkResize = () => {
            let currentWidth = window.visualViewport?.width || window.innerWidth;

            if (currentWidth !== startWidth) {
                this.#applyMasonryLayout(true);
            } else if (attempts < 3) {
                // Stop early if width remains stable
                attempts++;
                this.#debounceTimeout = setTimeout(checkResize, 50);
            }
        };

        this.#debounceTimeout = setTimeout(checkResize, 50);
    }

    #handleMutations(mutationsList) {
        let layoutChanged = false;

        for (const mutation of mutationsList) {
            if (mutation.type === "childList" && (mutation.addedNodes.length > 0 || mutation.removedNodes.length > 0)) {
                layoutChanged = true;
                break;
            }
        }

        if (layoutChanged) {
            if (this.#debounceTimeout) cancelAnimationFrame(this.#debounceTimeout);
            this.#debounceTimeout = requestAnimationFrame(() => {
                this.#applyMasonryLayout(false, true);
            });
        }
    }

    #applyMasonryLayout(isResize = false, isNewItem = false) {
        const previousColumnCount = this.#columnCount;
        this.#reset();
        const gapHorizontal = this.#getGapValue(this.#config.gapHorizontal);
        this.#columnCount = this.#getColumnCount(this.#config.baseColumnWidth, gapHorizontal);

        if (this.#columnCount < 1) return;

        const gapVertical = this.#getGapValue(this.#config.gapVertical);

        if (this.#columnCount !== previousColumnCount) {
            this.#dispatchColumnChangeEvent(this.#columnCount);
        }

        // Compute column width from stored `this.#width` (prevents reflow issues)
        const columnWidth = Math.max(0, (this.#width + gapHorizontal) / this.#columnCount - gapHorizontal);

        this.#columnHeightsTracker = new Array(this.#columnCount).fill(0);
        this.#elementHeights.length = 0;

        const children = Array.from(this.children);

        let childrenLength = children.length;
        let child, i = 0;

        // First pass: Apply width (batch updates to reduce reflows)
        for (; i < childrenLength; i++) {
            children[i].style.width = `${columnWidth}px`;
        }

        // Force reflow before reading heights (avoids flickering)
        this.offsetHeight;

        i = 0;

        // Second pass: Read heights (after styles have been applied)
        for (; i < childrenLength; i++) {
            this.#elementHeights[i] = children[i].clientHeight || 0;
        }

        const totalItemWidth = this.#columnCount * (columnWidth + gapHorizontal) - gapHorizontal;
        let initialLeft = 0;
        if (this.#columnCount > childrenLength) {
            initialLeft = Math.max(0, (this.#width - totalItemWidth) / 2);
        }

        let nextColumn, x, y;
        i = 0;

        requestAnimationFrame(() => {
            for (; i < childrenLength; i++) {
                child = children[i];
                nextColumn = this.#config.densePlacement ? this.#getShortestColumn() : this.#getNextColumn(i);
                x = Math.round(initialLeft + (columnWidth + gapHorizontal) * nextColumn);
                y = Math.round(this.#columnHeightsTracker[nextColumn]);

                child.style.transform = `translate(${x}px, ${y}px)`;
                this.#columnHeightsTracker[nextColumn] += (this.#elementHeights[i] || 0) + gapVertical;
            }

            this.style.height = `${this.#columnHeightsTracker[this.#getTallestColumn()] - gapVertical}px`;

            if (!this.#isTouch) {
                const transitionStyle = isResize && this.#config.animateOnResize ? `transform ${this.#config.animationDuration}ms cubic-bezier(0.25, 0.1, 0.25, 1)` : "none";
                i = 0;
                for (; i < childrenLength; i++) {
                    children[i].style.transition = transitionStyle;
                }
            }

            this.#dispatchLayoutCompleteEvent(children.length);
        });
    }

    #dispatchColumnChangeEvent(columns) {
        this.dispatchEvent(new CustomEvent("column-change", {
            detail: { columns }
        }));
    }

    #dispatchLayoutCompleteEvent(itemsCount) {
        this.dispatchEvent(new CustomEvent("layout-complete", {
            detail: {
                columns: this.#columnCount,
                items: itemsCount,
                containerHeight: this.style.height
            }
        }));
    }

    #getGapValue(gap) {
        if (typeof gap === "string" && gap.startsWith("--")) {
            return this.#getCssVariableValue(this, gap, true) ?? 0;
        }
        return parseInt(gap, 10) || 0;
    }

    #getCssVariableValue(el, varName, parseAsNumber = false) {
        const computedStyle = window.getComputedStyle(el);
        const value = computedStyle.getPropertyValue(varName)?.trim();
        if (!value) return parseAsNumber ? 0 : "";

        if (parseAsNumber) {
            const match = value.match(/^([\d.]+)(px|em|rem|%)?$/);
            if (!match) return 0;

            let numericValue = parseFloat(match[1]);
            const unit = match[2] || "px";

            if (unit === "em") {
                numericValue *= parseFloat(computedStyle.fontSize);
            } else if (unit === "rem") {
                numericValue *= parseFloat(getComputedStyle(document.documentElement).fontSize);
            } else if (unit === "%") {
                numericValue = (numericValue / 100) * this.#width;
            }

            return isNaN(numericValue) ? 0 : numericValue;
        }

        return value;
    }

    #getColumnCount(baseWidth, gapHorizontal) {
        let columnCount = this.#resolveColumnCount();

        if (columnCount !== null && columnCount > 0) {
            return Math.max(1, columnCount);
        }

        return Math.max(1, Math.floor((this.#width + gapHorizontal) / (baseWidth + gapHorizontal)));
    }

    #resolveColumnCount() {
        if (typeof this.#config.useColumnCount === "string") {
            return this.#getCssVariableValue(this, this.#config.useColumnCount, true);
        } else if (this.#config.useColumnCount === true) {
            return this.#getCssVariableValue(this, "--column-count", true);
        }
        return null;
    }

    #reset() {
        this.#width = this.clientWidth;
        this.#elementHeights.length = 0;
        this.#columnHeightsTracker.fill(0);
    }

    /**
     * When densePlacement is false, items are placed in columns in a round-robin order.
     * Example (3 columns):
     *
     * Item Order: 1 → 2 → 3 → 4 → 5 → 6
     *
     * Column 1      Column 2      Column 3
     * ---------     ---------     ---------
     * | Item 1 |    | Item 2 |    | Item 3 |
     * | Item 4 |    | Item 5 |    | Item 6 |
     * ---------     ---------     ---------
     */

    #getNextColumn(index) {
        return this.#columnHeightsTracker.length ? index % this.#columnHeightsTracker.length : 0;
    }

    /**
     * When densePlacement is true, items fill the shortest column first.
     * Example (3 columns, optimized layout):
     *
     * Column 1      Column 2      Column 3
     * ---------     ---------     ---------
     * | Item 1 |    | Item 2 |    | Item 3 |
     * | Item 6 |    | Item 4 |    | Item 5 |
     * | Item 7 |    | Item 8 |    | Item 9 |
     * ---------     ---------     ---------
     *
     * Reduces vertical gaps for a more compact layout.
     */

    #getShortestColumn() {
        if (!this.#columnHeightsTracker.length) return 0;
        let minIndex = 0;
        let minHeight = this.#columnHeightsTracker[0];
        let i = 1;
        let columnHeight;
        const columnHeightsTrackerLength = this.#columnHeightsTracker.length;

        for (; i < columnHeightsTrackerLength; i++) {
            columnHeight = this.#columnHeightsTracker[i];
            if (columnHeight < minHeight) {
                minHeight = columnHeight;
                minIndex = i;
            }
        }

        return minIndex;
    }

    #getTallestColumn() {
        if (!this.#columnHeightsTracker.length) return 0;
        let maxIndex = 0;
        let maxHeight = this.#columnHeightsTracker[0];
        let i = 1;
        let columnHeight;
        const columnHeightsTrackerLength = this.#columnHeightsTracker.length;

        for (; i < columnHeightsTrackerLength; i++) {
            columnHeight = this.#columnHeightsTracker[i];
            if (columnHeight > maxHeight) {
                maxHeight = columnHeight;
                maxIndex = i;
            }
        }

        return maxIndex;
    }

    forceUpdate() {
        this.#applyMasonryLayout(false, false);
    }

    triggerResize() {
        this.#handleResize();
    }

    toggleAnimation(enable) {
        this.#config.animateOnResize = enable;
    }

    setColumnCount(count) {
        if (typeof count !== "number" || count < 1) return;

        this.#config.useColumnCount = true;
        this.#config.baseColumnWidth = Math.floor(this.#width / count);
        this.#applyMasonryLayout(false, false);
    }

    getColumnCount() {
        return this.#columnCount;
    }

    destroy() {
        if (this.#config.observeMutations && this.#mutationObserver) {
            this.#mutationObserver.disconnect();
            this.#mutationObserver = null;
        }

        if (this.#isTouch) {
            window.removeEventListener("orientationchange", this.#boundHandleResize);
        } else {
            window.removeEventListener("resize", this.#boundHandleResize);
        }

        const children = Array.from(this.children);

        for (let child of children) {
            child.style.cssText = "";
        }

        this.style.removeProperty("height");
        this.#elementHeights.length = 0;
        this.#columnHeightsTracker.length = 0;
        this.#columnCount = null;
    }

}

customElements.define("simple-masonry", SimpleMasonry);

document.addEventListener("DOMContentLoaded", () => {

    const masonry = document.querySelector("#test-simple-masonry-01");

    if (masonry) {
        window.lightGallery(masonry, {
            selector: '.lightgallery',
            plugins: [lgZoom],
            zoomFromOrigin: false,
            mode: 'lg-fade',
            share: false,
    autoplayControls: false,
    download: false,
           
        });
    }

    // === Links Validation ===
    // https://assets.codepen.io/573855/lr-utils.js
    // https://codepen.io/luis-lessrain/pen/pvzVozd
    const isCodePen = document.referrer.includes("codepen.io");
    const hostDomains = isCodePen ? ["codepen.io"] : [];
    hostDomains.push(window.location.hostname);

    const links = document.getElementsByTagName("a");
    LR.utils.urlUtils.validateLinks(links, hostDomains,["lightgallery"]);
});



/* Toggle between adding and removing the "responsive" class to topnav when the user clicks on the icon */
function myFunction() {
  var x = document.getElementById("myTopnav");
  if (x.className === "topnav") {
    x.className += " responsive";
  } else {
    x.className = "topnav";
  }
} 
//Toggling Menu
const showMenu = (toggleId, navId) => {
    const toggle = document.getElementById(toggleId);
    const nav = document.getElementById(navId);

    if(toggle && nav) {
        toggle.addEventListener('click', () => {
            nav.classList.toggle('show');
        })
    }
}

showMenu('nav-toggle', 'nav-menu');

//Toggling Active Link
const navLink = document.querySelectorAll('.nav-link');

function linkAction() {
    navLink.forEach(n => n.classList.remove('active'));
    this.classList.add('active');

    const navMenu = document.getElementById('nav-menu');
    navMenu.classList.remove('show');
}

navLink.forEach(n => n.addEventListener('click', linkAction));

// Scroll Reveal

const sr = ScrollReveal({
    origin: 'top',
    distance: '80px',
    duration: 2000,
    reset: true
})

sr.reveal('.home-title', {} )
sr.reveal('.button', {delay: 200} )
sr.reveal('.home-img', {delay: 400} )
sr.reveal('.home-social', {delay: 400,} )

sr.reveal('.about-img', {} )
sr.reveal('.about-subtitle', {delay: 200} )
sr.reveal('.about-text', {delay: 400} )

sr.reveal('.skills-subtitle', {delay: 100} )
sr.reveal('.skills-text', {delay: 150} )
sr.reveal('.skills-data', {interval: 200} )
sr.reveal('.skills-img', {delay: 400} )

sr.reveal('.work-img', {interval: 200} )

sr.reveal('.contact-input', {interval: 200} )

var timerID;
window.onload = function() {
  canvas = document.getElementById('myCanvas');
  ctx = canvas.getContext('2d');

  var video = document.getElementById('video');

  video.addEventListener('play', function() {
    video.currentTime = 0;
    timerID = window.setInterval(function() {
      ctx.drawImage(video, 0, 0, 600, 460)
    }, 30);
  });

  video.addEventListener('pause', function() {
    stopTimer();
  });

  video.addEventListener('ended', function() {
    stopTimer();
  });
}






const nounPairs = [
  ["l'amitié (f)", "friendship"],
  ["la pensée", "thought"],
  ["la sculpture", "sculpture"],
  ["la boutique", "shop"],
  ["la paix", "peace"],
  ["la note", "grade"],
  ["la décision", "decision"],
  ["la classe", "class"],
  ["le rêve", "dream"],
  ["l'information (f)", "information"],
  ["le tableau", "painting/canvas"],
  ["la liberté", "freedom"],
  ["le niveau", "level"],
  ["le progrès", "progress"],
  ["le concert", "concert"],
  ["le livre", "book"],
  ["le crime", "crime"],
  ["le sentiment", "feeling"],
  ["le film", "movie"],
  ["le système", "system"],
  ["le produit", "product"],
  ["la santé", "health"],
  ["le chapitre", "chapter"],
  ["le point de vue", "point of view"],
  ["le marché", "market"],
  ["le gouvernement", "government"],
  ["le besoin", "need"],
  ["la vérité", "truth"],
  ["la matière", "subject"],
  ["la culture", "culture"],
  ["l'expression (f)", "expression"],
  ["la traduction", "translation"],
  ["le client", "customer"],
  ["la musique", "music"],
  ["le respect", "respect"],
  ["l'artiste (m/f)", "artist"],
  ["la photo", "photo"],
  ["le projet", "project"],
  ["la mémoire", "memory"],
  ["le mot", "word"],
  ["le temps", "time"],
  ["la page", "page"],
  ["le spectacle", "show"],
  ["le chanteur", "singer (male)"],
  ["le sens", "meaning"],
  ["la scène", "stage/scene"],
  ["l'image (f)", "image"],
  ["l'ordinateur (m)", "computer"],
  ["la phrase", "sentence"],
  ["la méthode", "method"],
  ["la langue", "language"],
  ["le service", "service"],
  ["le débat", "debate"],
  ["le travail", "work"],
  ["le bonheur", "happiness"],
  ["le choix", "choice"],
  ["la solution", "solution"],
  ["la chanson", "song"],
  ["le conseil", "advice"],
  ["le voyage", "trip"],
  ["le temps", "time"],
  ["la peinture", "painting"],
  ["la demande", "request"],
  ["le chapitre", "chapter"],
  ["l'objectif (m)", "goal"],
  ["l'achat (m)", "purchase"],
  ["le dictionnaire", "dictionary"],
  ["la galerie", "gallery"],
  ["le résultat", "result"],
  ["la jeunesse", "youth"],
  ["le professeur", "teacher"],
  ["l'université (f)", "university"],
  ["le chanteur", "singer (male)"],
  ["la chanteuse", "singer (female)"],
  ["l'échec (m)", "failure"],
  ["l'expérience (f)", "experience"],
  ["la maison", "house"],
  ["l'élève (m/f)", "student"],
  ["le cours", "course"],
  ["le développement", "development"],
  ["l'offre (f)", "offer"],
  ["le sujet", "subject"],
  ["le rêve", "dream"],
  ["le problème", "problem"],
  ["la loi", "law"],
  ["le spectacle", "show"],
  ["le progrès", "progress"],
  ["le tableau", "painting/canvas"],
  ["le système", "system"],
  ["le respect", "respect"],
  ["la page", "page"],
  ["la peinture", "painting"],
  ["le projet", "project"],
  ["la galerie", "gallery"],
  ["la mémoire", "memory"],
  ["le conseil", "advice"],
  ["le voyage", "trip"],
  ["le rêve", "dream"],
  ["la décision", "decision"],
  ["la traduction", "translation"],
  ["la santé", "health"],
  ["la boutique", "shop"],
  ["le film", "movie"],
  ["la paix", "peace"],
  ["la culture", "culture"],
];

const verbPairs = [
    ["travailler", "to work"],
  ["s'intéresser", "to be interested"],
  ["avoir (irr)", "to have"],
  ["apprendre (irr)", "to learn"],
  ["ignorer", "to ignore"],
  ["rester", "to stay"],
  ["regarder", "to watch/look at"],
  ["se coucher", "to go to bed"],
  ["descendre", "to go down"],
  ["chanter", "to sing"],
  ["payer", "to pay"],
  ["se brosser", "to brush (oneself)"],
  ["pouvoir (irr)", "to be able to"],
  ["s'amuser", "to have fun"],
  ["croire (irr)", "to believe"],
  ["utiliser", "to use"],
  ["détester", "to hate"],
  ["partir", "to leave"],
  ["venir (irr)", "to come"],
  ["connaître (irr)", "to know (someone)"],
  ["tomber", "to fall"],
  ["dessiner", "to draw"],
  ["dormir", "to sleep"],
  ["perdre", "to lose"],
  ["se lever", "to get up"],
  ["ouvrir (irr)", "to open"],
  ["compter", "to count"],
  ["voir (irr)", "to see"],
  ["dire (irr)", "to say/tell"],
  ["lire (irr)", "to read"],
  ["se réveiller", "to wake up"],
  ["refuser", "to refuse"],
  ["courir (irr)", "to run"],
  ["peindre", "to paint"],
  ["chanter", "to sing"],
  ["expliquer", "to explain"],
  ["accepter", "to accept"],
  ["savoir (irr)", "to know (a fact)"],
  ["finir", "to finish"],
  ["se laver", "to wash oneself"],
  ["envoyer", "to send"],
  ["rire (irr)", "to laugh"],
  ["prier", "to pray"],
  ["s'ennuyer", "to get bored"],
  ["se souvenir", "to remember"],
  ["visiter", "to visit"],
  ["boire", "to drink"],
  ["fermer", "to shut"],
  ["nettoyer", "to clean"],
  ["adorer", "to adore"],
  ["mettre (irr)", "to put"],
  ["comprendre (irr)", "to understand"],
  ["faire (irr)", "to do/make"],
  ["jouer", "to play"],
  ["habiter", "to reside"],
  ["arriver", "to arrive"],
  ["répondre", "to answer"],
  ["plaire", "to please"],
  ["naître", "to be born"],
  ["organiser", "to organize"],
  ["acheter", "to buy"],
  ["monter", "to go up"],
  ["changer", "to change"],
  ["se promener", "to take a walk"],
  ["espérer", "to hope"],
  ["vendre", "to sell"],
  ["parler", "to speak"],
  ["étudier", "to study"],
  ["téléphoner", "to call"],
  ["préférer", "to prefer"],
  ["souhaiter", "to wish"],
  ["aller (irr)", "to go"],
  ["entendre", "to hear"],
  ["remplir", "to fill"],
  ["être (irr)", "to be"],
  ["voyager", "to travel"],
  ["jeter", "to throw"],
  ["marcher", "to walk"],
  ["choisir", "to choose"],
  ["se reposer", "to rest"],
  ["vêtir", "to clothe"],
  ["conduire", "to drive"],
  ["essayer", "to try"],
  ["raconter", "to tell/narrate"],
  ["gagner", "to win/earn"],
  ["valoir", "to be worth"],
  ["exister", "to exist"],
  ["penser", "to think"],
  ["demander", "to ask"],
  ["recevoir (irr)", "to receive"],
  ["aider", "to help"],
  ["obéir", "to obey"],
  ["se dépêcher", "to hurry"],
  ["prêter", "to lend"],
  ["cuisiner", "to cook"],
  ["arrêter", "to stop"],
  ["changer", "to change"],
  ["revenir", "to come back"],
  ["reconnaître", "to recognize"],
  ["retourner", "to return"],
  ["voir (irr)", "to see"],
  ["s'habiller", "to get dressed"],
  ["commencer", "to start"],
  ["vivre (irr)", "to live"],
  ["se sentir", "to feel"]
];
const studyListKey = "studyWords";

let currentMode = "nouns"; // "nouns", "verbs", or "study"
// Load from localStorage (or fallback to empty array)
function loadStudyList() {
  return JSON.parse(localStorage.getItem(studyListKey)) || [];
}

// Save to localStorage
function saveStudyList(list) {
  localStorage.setItem(studyListKey, JSON.stringify(list));
}

let studyList = loadStudyList();

const saveBtn = document.getElementById("saveBtn");

saveBtn.addEventListener("click", () => {
  const [fr, en] = currentSet[currentIndex];
  const index = studyList.findIndex(pair => pair[0] === fr && pair[1] === en);

  if (currentMode === "study") {
    if (index > -1) {
      studyList.splice(index, 1);
      saveStudyList(studyList);
      saveBtn.classList.add("flash-delete");
setTimeout(() => {
  saveBtn.classList.remove("flash-delete");
}, 600);
      currentSet = studyList.length ? studyList : [["(none)", "(empty)"]];
      renderCarousel(currentSet);
    } else {
      alert("This word is not in your study list.");
    }
  } else {
    if (index === -1) {
      studyList.push([fr, en]);
      saveStudyList(studyList);
      saveBtn.classList.add("flash-success");
setTimeout(() => {
  saveBtn.classList.remove("flash-success");
}, 600);
    } else {
      alert("Already in study list.");
    }
  }
});


const ul = document.querySelector(".carousel-track");
const radios = document.querySelectorAll("input[name='wordType']");

let currentIndex = 0;
let currentSet = nounPairs;

function renderCarousel(pairs) {
  ul.innerHTML = "";
  currentIndex = 0;

  const shuffled = pairs.sort(() => 0.5 - Math.random());
  shuffled.forEach(([fr, en]) => {
    const li = document.createElement("li");
    li.classList.add("flip-card");
    li.innerHTML = `
      <div class="flip-inner">
        <div class="flip-front"><p>${fr}</p></div>
        <div class="flip-back"><p>${en}</p></div>
      </div>`;
    ul.appendChild(li);
  });

  document.querySelectorAll('.flip-card').forEach(card => {
    card.addEventListener('click', () => {
      card.classList.toggle('flipped');
    });
  });

  updateCarousel();
}

function updateCarousel() {
  const cards = ul.querySelectorAll("li");
  cards.forEach((card, i) => {
    card.style.transform = `translateX(${(i - currentIndex) * 100}%)`;
  });
}

// Navigation
function nextCard() {
  const total = ul.querySelectorAll("li").length;
  currentIndex = (currentIndex + 1) % total;
  updateCarousel();
}
function prevCard() {
  const total = ul.querySelectorAll("li").length;
  currentIndex = (currentIndex - 1 + total) % total;
  updateCarousel();
}

document.getElementById("nextBtn").addEventListener("click", nextCard);
document.getElementById("prevBtn").addEventListener("click", prevCard);

// Swipe
let startX = 0;
ul.addEventListener("touchstart", e => startX = e.touches[0].clientX);
ul.addEventListener("touchend", e => {
  const delta = e.changedTouches[0].clientX - startX;
  if (Math.abs(delta) > 50) delta < 0 ? nextCard() : prevCard();
});

// Keyboard
document.addEventListener("keydown", e => {
  if (e.key === "ArrowRight") nextCard();
  if (e.key === "ArrowLeft") prevCard();
});

// Mode toggle
radios.forEach(radio => {
  radio.addEventListener("change", () => {
    currentMode = radio.value;

    if (currentMode === "nouns") {
      currentSet = nounPairs;
      saveBtn.textContent = "Save to Study List";
      saveBtn.classList.remove('remove');
    } else if (currentMode === "verbs") {
      currentSet = verbPairs;
      saveBtn.textContent = "Save to Study List";
      saveBtn.classList.remove('remove');
    } else if (currentMode === "study") {
      studyList = loadStudyList();
      currentSet = studyList.length ? studyList : [["(none)", "(empty)"]];
      saveBtn.textContent = "Remove from Study List";
      saveBtn.classList.add('remove');
    }

    renderCarousel(currentSet);
  });
});


renderCarousel(currentSet);
