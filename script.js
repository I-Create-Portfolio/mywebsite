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
            mobileSettings: {
                controls: false,
                showCloseIcon: false,
                download: false,
                rotate: false
            },
           
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