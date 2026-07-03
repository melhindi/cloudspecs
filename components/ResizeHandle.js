import './splitview.css'
import './tableview.css'
import { debounce } from '../util.js'
import { toggleFavicon } from './favicons.js'
import state from './state.js'

export default class ResizeHandle {
  #isResizing; #grid; #handle; #button; #handlers; #callback; #curPct;

  constructor(grid, handle, button, resizedCallback = (pct) => {}) {
    this.#grid = grid;
    this.#handle = handle;
    this.#button = button;
    this.#isResizing = false;
    this.#callback = resizedCallback;
    this.#curPct = 0;
    this.#handlers = {move: this.pointerMove.bind(this),
                      up: this.pointerUp.bind(this),
                      down: this.pointerDown.bind(this),
                      toggle: this.toggle.bind(this)};
    // handle for dragging view
    $(this.#handle)[0].addEventListener("pointerdown", this.#handlers.down);
    // buttons for changing view type
    $(this.#button).click(this.#handlers.toggle);
    // window listener

    // public resize event on window resize as well
    const resizeHandler = debounce(() => state.setState({ viewsize: window.innerWidth }), 500/*ms*/);
    window.addEventListener('resize', resizeHandler);

    state.subscribe((newState, updates) => {
      console.log("ResizeHandle state update: ", newState, updates);
      if (!('layout' in updates)) return;
      const { type, percentage } = newState.layout;
      this.render(type, percentage);
    }, ['layout']);

    const { type, percentage } = state.getState().layout;
    this.render(type, percentage);
  }

  render(type, percentage) {
    console.log('re-rendering split');
    percentage = percentage || 50;
    const grid = $(this.#grid);
      if (type == 'split') {
        grid.removeClass('tableview').addClass('splitview');
        $(this.#button).html('Table only &#9654;');
        ResizeHandle.#applyGridWidth(grid[0], percentage);
      } else if (type == 'table') {
        grid.removeClass('splitview').addClass('tableview');
        $(this.#button).html('&#9664; Visualize (R+ggplot)');
        grid.removeAttr("style");
      } else {
        console.error("Unknown layout type: ", type);
      }
  }

  pointerDown(evt) {
    if (this.#isResizing || !evt.target.closest(this.#handle)) return;
    this.#isResizing = true;
    addEventListener("pointermove", this.#handlers.move);
    addEventListener("pointerup", this.#handlers.up);
  };

  pointerMove(evt) {
    evt.preventDefault();
    const grid = $(this.#grid)[0];
    const pct = 100 * (evt.clientX / grid.clientWidth);
    this.#curPct = pct;
    grid.style["grid-template-columns"] = `calc(${pct}% - 3px) 6px calc(${100-pct}% - 3px)`;
  };

  pointerUp(evt) {
    removeEventListener("pointermove", this.#handlers.move);
    removeEventListener("pointerup", this.#handlers.up);
    this.#isResizing = false;
    state.setState({ layout: { type: 'split', percentage: this.#curPct } });
  };

  toggle(evt) {
    const { layout } = state.getState();
    
    let crackedMode = false;
    if (layout.type == 'table') {
      state.setState({ layout: { type: 'split', percentage: layout.percentage || 50 } });
      crackedMode = true;
    } else {
      state.setState({ layout: { type: 'table' } });
    }
    toggleFavicon(crackedMode);
  }

  static #applyGridWidth(grid, pct) {
    grid.style["grid-template-columns"] = `calc(${pct}% - 3px) 6px calc(${100-pct}% - 3px)`;
  }

}
