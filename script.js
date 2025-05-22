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









document.addEventListener("DOMContentLoaded", () => {
  // Register GSAP plugins
  gsap.registerPlugin(CustomEase);
  // Create custom eases
  CustomEase.create("projectExpand", "0.25, 0.1, 0.25, 1.05");
  CustomEase.create("projectCollapse", "0.36, 0.07, 0.19, 0.97");
  CustomEase.create("textReveal", "0.25, 1, 0.5, 1");
  CustomEase.create("squareStretch", "0.22, 1, 0.36, 1");
  const projectItems = document.querySelectorAll(".project-item");
  let activeProject = null;
  let isClickAllowed = true;
  // Initialize text splitting
  projectItems.forEach((project) => {
    const detailElements = project.querySelectorAll(".project-details p");
    detailElements.forEach((element) => {
      // Create a simple text splitting approach that works without SplitType
      const originalText = element.innerText;
      element.innerHTML = "";
      const lineWrapper = document.createElement("div");
      lineWrapper.className = "line-wrapper";
      const lineElement = document.createElement("div");
      lineElement.className = "line";
      lineElement.innerText = originalText;
      lineWrapper.appendChild(lineElement);
      element.appendChild(lineWrapper);
      // Set initial GSAP position
      gsap.set(lineElement, {
        y: "100%",
        opacity: 0
      });
    });
    // Set initial state for project items - hide them
    projectItems.forEach((item) => {
      gsap.set(item, {
        opacity: 0,
        y: 15
      });
    });
    // Create staggered reveal animation on page load
    gsap.to(projectItems, {
      opacity: 1,
      y: 0,
      duration: 0.4,
      stagger: 0.06,
      ease: "none", // Linear easing as requested
      onComplete: () => {
        // Ensure all items are fully visible after animation
        gsap.set(projectItems, {
          clearProps: "opacity,y"
        });
      }
    });
    // Set up hover indicators
    const titleContainer = project.querySelector(".project-title-container");
    const leftIndicator = project.querySelector(".hover-indicator.left");
    const rightIndicator = project.querySelector(".hover-indicator.right");
    // Set proper initial state
    gsap.set(titleContainer, {
      transformPerspective: 1000,
      transformStyle: "preserve-3d"
    });
    // Set initial sizes for indicators
    gsap.set([leftIndicator, rightIndicator], {
      width: "0px", // Start with 0 width
      height: "8px",
      opacity: 1, // Always visible when animating
      transformOrigin: "center center",
      zIndex: 200 // Ensure indicators are always on top
    });
    // Add hover event listeners with fixed positioning
    titleContainer.addEventListener("mouseenter", () => {
      // Only show hover effect when NO project is active (no 3D perspective)
      if (!activeProject) {
        gsap.killTweensOf([leftIndicator, rightIndicator]);
        // Left square animation - start with 0 width, expand to 12px, then back to 8px
        gsap
          .timeline()
          .set(leftIndicator, {
            opacity: 1, // Always visible
            x: -20,
            width: "0px", // Start with 0 width
            height: "8px"
          })
          .to(leftIndicator, {
            x: -10,
            width: "12px", // Expand to 12px
            duration: 0.15,
            ease: "power2.in" // Ease in
          })
          .to(leftIndicator, {
            x: 0,
            width: "8px", // Back to 8px
            duration: 0.15,
            ease: "none" // Linear
          });
        // Right square animation (staggered)
        gsap
          .timeline({
            delay: 0.05
          })
          .set(rightIndicator, {
            opacity: 1, // Always visible
            x: 20,
            width: "0px", // Start with 0 width
            height: "8px"
          })
          .to(rightIndicator, {
            x: 10,
            width: "12px", // Expand to 12px
            duration: 0.15,
            ease: "power2.in" // Ease in
          })
          .to(rightIndicator, {
            x: 0,
            width: "8px", // Back to 8px
            duration: 0.15,
            ease: "none" // Linear
          });
      }
    });
    titleContainer.addEventListener("mouseleave", () => {
      // Only animate out when NO project is active
      if (!activeProject) {
        gsap.killTweensOf([leftIndicator, rightIndicator]);
        // Left square animation - start at 8px, expand to 12px, then shrink to 0px
        gsap
          .timeline()
          .to(leftIndicator, {
            x: -10,
            width: "12px", // Expand to 12px
            duration: 0.15,
            ease: "none" // Linear
          })
          .to(leftIndicator, {
            x: -20,
            width: "0px", // Shrink to 0px
            duration: 0.15,
            ease: "power2.out" // Ease out
          });
        // Right square animation - start at 8px, expand to 12px, then shrink to 0px
        gsap
          .timeline()
          .to(rightIndicator, {
            x: 10,
            width: "12px", // Expand to 12px
            duration: 0.15,
            ease: "none" // Linear
          })
          .to(rightIndicator, {
            x: 20,
            width: "0px", // Shrink to 0px
            duration: 0.15,
            ease: "power2.out" // Ease out
          });
      }
    });
  });
  // Function to apply 3D transforms with opposite directions
  const applyStarWarsEffect = (activeIndex) => {
    projectItems.forEach((item, index) => {
      const titleContainer = item.querySelector(".project-title-container");
      // Skip the active project
      if (index === activeIndex) {
        gsap.to(titleContainer, {
          rotateX: 0,
          rotateY: 0,
          translateZ: 0,
          translateY: 0,
          scale: 1,
          duration: 0.6,
          ease: "power2.out",
          zIndex: 50 // Active item should be on top
        });
        return;
      }
      // Calculate distance from active project
      const distance = Math.abs(index - activeIndex);
      // Determine if item is above or below active
      const isAbove = index < activeIndex;
      // Calculate transform values based on distance and position
      // Items above rotate opposite to items below
      let rotateX, translateZ, translateY;
      if (distance === 1) {
        rotateX = isAbove ? 12 : -12; // Opposite directions
        translateZ = -80;
        translateY = isAbove ? -15 : 15;
      } else if (distance === 2) {
        rotateX = isAbove ? 20 : -20; // Opposite directions
        translateZ = -160;
        translateY = isAbove ? -30 : 30;
      } else {
        rotateX = isAbove ? 30 : -30; // Opposite directions
        translateZ = -240;
        translateY = isAbove ? -45 : 45;
      }
      // Apply transform with GSAP
      gsap.to(titleContainer, {
        rotateX: rotateX,
        translateZ: translateZ,
        translateY: translateY,
        scale: 1 - distance * 0.05, // Subtle scaling based on distance
        duration: 0.6,
        ease: "power2.out",
        zIndex: 40 - distance * 5 // Ensure proper stacking
      });
      // Make sure hover indicators stay on top
      const leftIndicator = item.querySelector(".hover-indicator.left");
      const rightIndicator = item.querySelector(".hover-indicator.right");
      gsap.set([leftIndicator, rightIndicator], {
        zIndex: 200 // Always keep indicators on top
      });
    });
  };
  // Function to reset all transforms
  const resetTransforms = () => {
    projectItems.forEach((item) => {
      const titleContainer = item.querySelector(".project-title-container");
      gsap.to(titleContainer, {
        rotateX: 0,
        rotateY: 0,
        translateZ: 0,
        translateY: 0,
        scale: 1,
        duration: 0.6,
        ease: "power2.out",
        zIndex: 1
      });
      // Reset hover indicators to initial state
      const leftIndicator = item.querySelector(".hover-indicator.left");
      const rightIndicator = item.querySelector(".hover-indicator.right");
      gsap.set([leftIndicator, rightIndicator], {
        width: "0px",
        x: function (i) {
          return i === 0 ? -20 : 20;
        }
      });
    });
  };
  // Function to close all projects
  const closeAllProjects = () => {
    projectItems.forEach((item) => {
      item.classList.remove("active");
    });
    activeProject = null;
    resetTransforms();
  };
  // Set initial states for images
  gsap.set(".image-wrapper img", {
    clipPath: "inset(100% 0 0 0)"
  });
  // Function to toggle project with debounce
  const toggleProject = (project) => {
    // If clicking is not allowed (debounce), return
    if (!isClickAllowed) return;
    // Set clicking to not allowed
    isClickAllowed = false;
    // Allow clicking again after delay
    setTimeout(() => {
      isClickAllowed = true;
    }, 500); // 500ms debounce
    // If clicking the active project, close it
    if (activeProject === project) {
      // Hide content first
      const image = project.querySelector(".image-wrapper img");
      const leftDetails = project.querySelectorAll(".project-details .line");
      const rightDetails = project.querySelectorAll(".project-details .line");
      const title = project.querySelector(".project-title");
      const content = project.querySelector(".project-content");
      // Animate letter spacing back to normal
      gsap.to(title, {
        letterSpacing: "-0.02em",
        duration: 0.3,
        ease: "projectCollapse"
      });
      // Animate image out with clip-path - faster with linear easing
      gsap.to(image, {
        clipPath: "inset(100% 0 0 0)",
        duration: 0.2, // Faster animation
        ease: "none" // Linear easing
      });
      gsap.to([...leftDetails, ...rightDetails], {
        y: "100%",
        opacity: 0,
        duration: 0.3,
        stagger: 0.03, // Faster stagger
        ease: "projectCollapse"
      });
      gsap.to(content, {
        maxHeight: 0,
        opacity: 0,
        margin: 0,
        duration: 0.3,
        ease: "projectCollapse"
      });
      // After animation, remove active class
      setTimeout(() => {
        project.classList.remove("active");
        activeProject = null;
        resetTransforms();
        // Reset spacing when no project is active
        gsap.to(".project-item", {
          marginBottom: "1.5rem",
          duration: 0.4,
          ease: "projectExpand",
          stagger: 0.02
        });
      }, 300);
    } else {
      // Close all projects first
      if (activeProject) {
        // Hide content of previously active project
        const prevImage = activeProject.querySelector(".image-wrapper img");
        const prevLeftDetails = activeProject.querySelectorAll(
          ".project-details .line"
        );
        const prevRightDetails = activeProject.querySelectorAll(
          ".project-details .line"
        );
        const prevTitle = activeProject.querySelector(".project-title");
        const prevContent = activeProject.querySelector(".project-content");
        // Animate letter spacing back to normal
        gsap.to(prevTitle, {
          letterSpacing: "-0.02em",
          duration: 0.25,
          ease: "projectCollapse"
        });
        // Animate image out with clip-path - faster with linear easing
        gsap.to(prevImage, {
          clipPath: "inset(100% 0 0 0)",
          duration: 0.2, // Faster animation
          ease: "none" // Linear easing
        });
        gsap.to([...prevLeftDetails, ...prevRightDetails], {
          y: "100%",
          opacity: 0,
          duration: 0.25,
          stagger: 0.02,
          ease: "projectCollapse"
        });
        gsap.to(prevContent, {
          maxHeight: 0,
          opacity: 0,
          margin: 0,
          duration: 0.25,
          ease: "projectCollapse"
        });
        // After animation, remove active class
        setTimeout(() => {
          closeAllProjects();
          openProject();
        }, 250);
      } else {
        openProject();
      }

      function openProject() {
        // Hide any visible hover indicators
        document.querySelectorAll(".hover-indicator").forEach((indicator) => {
          gsap.killTweensOf(indicator);
          gsap.set(indicator, {
            width: "0px",
            x: indicator.classList.contains("left") ? -20 : 20
          });
        });
        // Open the clicked project
        project.classList.add("active");
        activeProject = project;
        // Apply Star Wars effect with opposite directions
        const activeIndex = Array.from(projectItems).indexOf(project);
        applyStarWarsEffect(activeIndex);
        // Get elements to animate
        const image = project.querySelector(".image-wrapper img");
        const leftDetails = project.querySelectorAll(
          ".project-details.left .line"
        );
        const rightDetails = project.querySelectorAll(
          ".project-details.right .line"
        );
        const title = project.querySelector(".project-title");
        const content = project.querySelector(".project-content");
        // Reset positions before animating
        gsap.set(image, {
          clipPath: "inset(100% 0 0 0)"
        });
        gsap.set([...leftDetails, ...rightDetails], {
          y: "100%",
          opacity: 0
        });
        gsap.set(content, {
          display: "flex",
          maxHeight: 0,
          opacity: 0,
          margin: 0
        });
        // Create timeline for staggered animations
        const tl = gsap.timeline({
          defaults: {
            ease: "textReveal"
          }
        });
        // Animate letter spacing expansion
        tl.to(
          title,
          {
            letterSpacing: "0.01em",
            duration: 0.4,
            ease: "projectExpand"
          },
          0
        );
        // Expand content
        tl.to(
          content,
          {
            maxHeight: 500, // Large enough for most content
            opacity: 1,
            margin: "2rem 0",
            duration: 0.4,
            ease: "projectExpand"
          },
          0
        );
        // Add animations to timeline - faster image reveal with linear easing
        tl.to(
          image,
          {
            clipPath: "inset(0% 0 0 0)",
            duration: 0.3, // Faster animation
            ease: "none" // Linear easing
          },
          0
        );
        // Staggered text reveals
        tl.to(
          leftDetails,
          {
            y: "0%",
            opacity: 1,
            duration: 0.45,
            stagger: 0.05,
            ease: "textReveal"
          },
          "-=0.2"
        );
        tl.to(
          rightDetails,
          {
            y: "0%",
            opacity: 1,
            duration: 0.45,
            stagger: 0.05,
            ease: "textReveal"
          },
          "-=0.4"
        );
        // Adjust spacing for better visibility
        const projectIndex = Array.from(projectItems).indexOf(project);
        // Compress projects above the active one
        if (projectIndex > 0) {
          gsap.to(Array.from(projectItems).slice(0, projectIndex), {
            marginBottom: "0.5rem",
            duration: 0.4,
            ease: "projectCollapse",
            stagger: 0.02
          });
        }
        // Compress projects below the active one
        if (projectIndex < projectItems.length - 1) {
          gsap.to(Array.from(projectItems).slice(projectIndex + 1), {
            marginBottom: "0.5rem",
            duration: 0.4,
            ease: "projectCollapse",
            stagger: 0.02
          });
        }
        // Ensure the active project is visible within the container
        setTimeout(() => {
          const projectsList = document.querySelector(".projects-list");
          const rect = project.getBoundingClientRect();
          const containerRect = projectsList.getBoundingClientRect();
          if (
            rect.top < containerRect.top ||
            rect.bottom > containerRect.bottom
          ) {
            const scrollOffset =
              rect.top -
              containerRect.top -
              containerRect.height / 2 +
              rect.height / 2;
            projectsList.scrollBy({
              top: scrollOffset,
              behavior: "smooth"
            });
          }
        }, 100);
      }
    }
  };
  // Add click event listeners to all project items
  projectItems.forEach((item) => {
    item.addEventListener("click", () => {
      toggleProject(item);
    });
  });
  // Handle window resize
  window.addEventListener("resize", () => {
    // If a project is active, make sure it's still visible
    if (activeProject) {
      const projectsList = document.querySelector(".projects-list");
      const rect = activeProject.getBoundingClientRect();
      const containerRect = projectsList.getBoundingClientRect();
      if (rect.top < containerRect.top || rect.bottom > containerRect.bottom) {
        const scrollOffset =
          rect.top -
          containerRect.top -
          containerRect.height / 2 +
          rect.height / 2;
        projectsList.scrollBy({
          top: scrollOffset,
          behavior: "smooth"
        });
      }
    }
  });
  // Clean up any lingering animations when user tabs away
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      // Reset all hover indicators when page is not visible
      document.querySelectorAll(".hover-indicator").forEach((indicator) => {
        gsap.killTweensOf(indicator);
        gsap.set(indicator, {
          width: "0px",
          x: indicator.classList.contains("left") ? -20 : 20
        });
      });
    }
  });
});











