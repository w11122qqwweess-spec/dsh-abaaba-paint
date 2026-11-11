window.__ModuleLoader__.load({
  id: 'dsh-abaaba-paint',
  factory(require) {
    const React = require('react');
    const h = React.createElement;
    const { useCallback, useEffect, useMemo, useRef, useState } = React;

    const NS = 'dsh-abaaba-paint';
    const DICT = {
      zh: {
        'panel.title': 'Abaaba 画室',
        'panel.subtitle': 'Agent 的实时矢量画布',
        'panel.loading': '正在取画布…',
        'panel.empty': '画布还是空的',
        'panel.emptyHint': '让 Agent 调用 paint_create 和 paint_draw 落下第一笔。',
        'panel.undo': '撤销',
        'panel.clear': '清空',
        'panel.confirmClear': '清空整张画布？会立即覆盖工作区快照；只能在本进程内撤销。',
        'panel.save': '保存 SVG',
        'panel.saveWorkspace': '保存到工作区',
        'panel.reload': '重载',
        'panel.saved': '已自动保存 · {time}',
        'panel.savedAt': '已保存到工作区 · {time}',
        'panel.saveFailed': '保存失败：{message}',
        'panel.unbound': '首次落笔后绑定工作区',
        'panel.noSession': '请先选择一个会话',
        'panel.handoff': '交接',
        'panel.fit': '适应',
        'panel.zoomIn': '放大',
        'panel.zoomOut': '缩小',
        'panel.zoom100': '100%',
        'panel.full': '全屏',
        'panel.exitFull': '退出全屏',
        'panel.handoffTitle': '交接作品',
        'panel.handoffEmpty': '工作区还没有交接作品',
        'panel.handoffLoading': '读取交接列表…',
        'panel.handoffImport': '导入并替换',
        'panel.handoffConfirm': '导入会替换当前画布，继续？',
        'panel.handoffFailed': '交接列表失败：{message}',
        'panel.handoffSource': '来自 {source}',
        'panel.handoffMeta': '{width}×{height} · {count} 图元',
        'panel.refresh': '刷新',
        'panel.revision': '第 {revision} 版',
        'panel.elements': '{count} 个图元',
        'panel.updated': '更新于 {time}',
        'panel.busy': '处理中…',
        'panel.error': '画室连接失败：{message}',
        'panel.stale': '画布已被另一处更新，已刷新，请重试。',
        'panel.ariaCanvas': 'Abaaba 画布',
        'panel.ariaToolbar': '画布操作',
        'status.live': '实时同步',
        'status.offline': '同步中断',
      },
      en: {
        'panel.title': 'Abaaba Paint',
        'panel.subtitle': 'A live vector canvas for the Agent',
        'panel.loading': 'Loading canvas…',
        'panel.empty': 'The canvas is empty',
        'panel.emptyHint': 'Ask the Agent to call paint_create and paint_draw.',
        'panel.undo': 'Undo',
        'panel.clear': 'Clear',
        'panel.confirmClear': 'Clear the whole canvas? This immediately overwrites the workspace snapshot and is only undoable in this process.',
        'panel.save': 'Save SVG',
        'panel.saveWorkspace': 'Save to workspace',
        'panel.reload': 'Reload',
        'panel.saved': 'Auto-saved · {time}',
        'panel.savedAt': 'Saved to workspace · {time}',
        'panel.saveFailed': 'Save failed: {message}',
        'panel.unbound': 'Workspace binds on first stroke',
        'panel.noSession': 'Select a session first',
        'panel.handoff': 'Handoff',
        'panel.fit': 'Fit',
        'panel.zoomIn': 'Zoom in',
        'panel.zoomOut': 'Zoom out',
        'panel.zoom100': '100%',
        'panel.full': 'Fullscreen',
        'panel.exitFull': 'Exit fullscreen',
        'panel.handoffTitle': 'Handoff inbox',
        'panel.handoffEmpty': 'No handoff artifacts in this workspace yet',
        'panel.handoffLoading': 'Loading handoff inbox…',
        'panel.handoffImport': 'Import & replace',
        'panel.handoffConfirm': 'Importing replaces the current canvas. Continue?',
        'panel.handoffFailed': 'Handoff inbox failed: {message}',
        'panel.handoffSource': 'From {source}',
        'panel.handoffMeta': '{width}×{height} · {count} elements',
        'panel.refresh': 'Refresh',
        'panel.revision': 'Revision {revision}',
        'panel.elements': '{count} elements',
        'panel.updated': 'Updated {time}',
        'panel.busy': 'Working…',
        'panel.error': 'Paint connection failed: {message}',
        'panel.stale': 'The canvas changed elsewhere. Refreshed; please retry.',
        'panel.ariaCanvas': 'Abaaba canvas',
        'panel.ariaToolbar': 'Canvas actions',
        'status.live': 'Live',
        'status.offline': 'Offline',
      },
    };

    const CSS = `
      .abaaba-panel {
        display: flex; flex-direction: column; height: 100%; min-height: 0;
        background: var(--dsw-alias-bg-base); color: var(--dsw-alias-label-primary);
        font-family: inherit;
      }
      .abaaba-header {
        display: flex; align-items: flex-start; justify-content: space-between;
        gap: 18px; padding: 20px 26px 14px; border-bottom: 1px solid var(--dsw-alias-border-l1);
      }
      .abaaba-heading { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
      .abaaba-title { margin: 0; font-size: 18px; line-height: 1.25; font-weight: 650; letter-spacing: .2px; }
      .abaaba-subtitle { margin: 0; color: var(--dsw-alias-label-secondary); font-size: 12px; line-height: 1.4; }
      .abaaba-toolbar { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; justify-content: flex-end; }
      .abaaba-btn {
        appearance: none; border: 1px solid var(--dsw-alias-border-l2);
        background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-primary);
        border-radius: 8px; padding: 7px 11px; font: inherit; font-size: 12px; line-height: 1.2;
        cursor: pointer; transition: background .15s ease, border-color .15s ease, opacity .15s ease;
        white-space: nowrap;
      }
      .abaaba-btn:hover:not(:disabled) { background: var(--dsw-alias-bg-layer-2); border-color: var(--dsw-alias-brand-primary); }
      .abaaba-btn:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 2px; }
      .abaaba-btn:disabled { opacity: .45; cursor: default; }
      .abaaba-btn.primary { border-color: var(--dsw-alias-brand-primary); color: var(--dsw-alias-brand-primary); }
      .abaaba-meta { display: flex; align-items: center; gap: 10px; color: var(--dsw-alias-label-secondary); font-size: 11px; }
      .abaaba-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--dsw-alias-state-success-primary); }
      .abaaba-dot.offline { background: var(--dsw-alias-state-error-primary); }
      .abaaba-stage { flex: 1; min-height: 0; display: flex; align-items: stretch; justify-content: stretch; padding: 18px 26px; }
      .abaaba-viewport {
        position: relative; flex: 1; min-height: 0; overflow: hidden; border-radius: 14px;
        border: 1px solid var(--dsw-alias-border-l1); background: #070b14;
        box-shadow: 0 18px 55px rgba(0, 0, 0, .28); cursor: grab; touch-action: none; overscroll-behavior: contain;
      }
      .abaaba-viewport:active { cursor: grabbing; }
      .abaaba-canvas { position: absolute; left: 50%; top: 50%; transform-origin: center; will-change: transform; }
      .abaaba-canvas svg { display: block; width: 100%; height: 100%; }
      .abaaba-zoom {
        position: absolute; right: 14px; bottom: 14px; display: flex; align-items: center; gap: 5px;
        padding: 5px; border-radius: 9px; background: rgba(7, 11, 20, .78);
        border: 1px solid rgba(169, 196, 214, .22); backdrop-filter: blur(8px);
      }
      .abaaba-zoom-btn {
        appearance: none; border: 1px solid transparent; background: transparent;
        color: #F7F2E8; border-radius: 6px; min-width: 26px; height: 26px; padding: 0 6px;
        font: inherit; font-size: 12px; cursor: pointer;
      }
      .abaaba-zoom-btn.wide { min-width: 44px; color: #A9C4D6; }
      .abaaba-zoom-btn:hover { background: rgba(169, 196, 214, .14); border-color: rgba(169, 196, 214, .22); }
      .abaaba-zoom-btn:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 1px; }
      .abaaba-zoom-label { min-width: 42px; text-align: center; color: #A9C4D6; font-size: 11px; }
      .abaaba-frame {
        position: relative; width: 100%; max-width: 1240px; max-height: 100%;
        aspect-ratio: var(--abaaba-aspect, 3 / 2); overflow: hidden; border-radius: 14px;
        border: 1px solid var(--dsw-alias-border-l1); background: #070b14;
        box-shadow: 0 18px 55px rgba(0, 0, 0, .28);
      }
      .abaaba-frame svg { display: block; width: 100%; height: 100%; }
      .abaaba-panel.abaaba-full { position: fixed; inset: 0; z-index: 1000; height: 100vh; height: 100dvh; }
      .abaaba-panel.abaaba-full .abaaba-header,
      .abaaba-panel.abaaba-full .abaaba-footer,
      .abaaba-panel.abaaba-full .abaaba-alert,
      .abaaba-panel.abaaba-full .abaaba-handoffs { display: none; }
      .abaaba-panel.abaaba-full .abaaba-stage { padding: 0; }
      .abaaba-panel.abaaba-full .abaaba-viewport { border: 0; border-radius: 0; }
      .abaaba-empty {
        position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center;
        justify-content: center; gap: 8px; padding: 24px; text-align: center; pointer-events: none;
        color: #A9C4D6; background: radial-gradient(circle at 50% 40%, rgba(110,147,184,.10), transparent 60%);
      }
      .abaaba-empty strong { font-size: 16px; font-weight: 600; color: #F7F2E8; }
      .abaaba-empty span { font-size: 12px; max-width: 460px; line-height: 1.5; opacity: .8; }
      .abaaba-footer {
        display: flex; align-items: center; justify-content: space-between; gap: 12px;
        padding: 0 26px 16px; color: var(--dsw-alias-label-secondary); font-size: 11px;
      }
      .abaaba-persistence { color: var(--dsw-alias-state-success-primary); }
      .abaaba-save-error { color: var(--dsw-alias-state-error-primary); }
      .abaaba-handoffs {
        margin: 0 26px 10px; padding: 12px; border: 1px solid var(--dsw-alias-border-l1);
        border-radius: 10px; background: var(--dsw-alias-bg-layer-1);
        max-height: 280px; overflow: auto;
      }
      .abaaba-handoff-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; }
      .abaaba-handoff-title { font-size: 12px; font-weight: 650; }
      .abaaba-handoff-empty, .abaaba-handoff-error { font-size: 12px; color: var(--dsw-alias-label-secondary); padding: 8px 0; }
      .abaaba-handoff-error { color: var(--dsw-alias-state-error-primary); }
      .abaaba-handoff-list { display: flex; flex-direction: column; gap: 8px; }
      .abaaba-handoff-card { display: flex; align-items: center; gap: 10px; padding: 8px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 8px; }
      .abaaba-handoff-thumb { width: 96px; height: 64px; object-fit: cover; border-radius: 6px; background: #070b14; flex: none; }
      .abaaba-handoff-copy { display: flex; flex-direction: column; gap: 3px; min-width: 0; flex: 1; }
      .abaaba-handoff-name { font-size: 12px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .abaaba-handoff-meta { font-size: 11px; color: var(--dsw-alias-label-secondary); }
      .abaaba-alert {
        margin: 0 26px 10px; padding: 8px 10px; border-radius: 8px; font-size: 12px;
        color: var(--dsw-alias-state-error-primary); background: var(--dsw-alias-bg-layer-1);
        border: 1px solid var(--dsw-alias-state-error-primary);
      }
      @media (max-width: 760px) {
        .abaaba-header { flex-direction: column; padding: 14px 16px 10px; }
        .abaaba-toolbar { justify-content: flex-start; }
        .abaaba-stage { padding: 12px 16px; }
        .abaaba-footer { padding: 0 16px 12px; }
        .abaaba-handoffs {
        margin: 0 26px 10px; padding: 12px; border: 1px solid var(--dsw-alias-border-l1);
        border-radius: 10px; background: var(--dsw-alias-bg-layer-1);
        max-height: 280px; overflow: auto;
      }
      .abaaba-handoff-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; }
      .abaaba-handoff-title { font-size: 12px; font-weight: 650; }
      .abaaba-handoff-empty, .abaaba-handoff-error { font-size: 12px; color: var(--dsw-alias-label-secondary); padding: 8px 0; }
      .abaaba-handoff-error { color: var(--dsw-alias-state-error-primary); }
      .abaaba-handoff-list { display: flex; flex-direction: column; gap: 8px; }
      .abaaba-handoff-card { display: flex; align-items: center; gap: 10px; padding: 8px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 8px; }
      .abaaba-handoff-thumb { width: 96px; height: 64px; object-fit: cover; border-radius: 6px; background: #070b14; flex: none; }
      .abaaba-handoff-copy { display: flex; flex-direction: column; gap: 3px; min-width: 0; flex: 1; }
      .abaaba-handoff-name { font-size: 12px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .abaaba-handoff-meta { font-size: 11px; color: var(--dsw-alias-label-secondary); }
      .abaaba-alert { margin: 0 16px 10px; }
      }
    `;

    function tFactory(ctx) {
      const translate = ctx.locale.bind(NS);
      return (key, params = {}) => {
        let text;
        try {
          text = translate(key, params);
        } catch {
          text = key;
        }
        if (typeof text !== 'string') text = key;
        return text.replace(/\{(\w+)\}/g, (_match, name) => String(params[name] ?? `{${name}}`));
      };
    }

    function PaintIcon({ size, active }) {
      const color = active ? 'var(--dsw-alias-brand-primary)' : 'currentColor';
      return h('svg', {
        width: size,
        height: size,
        viewBox: '0 0 24 24',
        fill: 'none',
        stroke: color,
        strokeWidth: 1.7,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
        'aria-hidden': true,
        style: { display: 'block' },
      },
        h('rect', { x: 3, y: 3, width: 18, height: 18, rx: 4 }),
        h('path', { d: 'M7.2 15.4c1.6-4.7 3.7-7 6.1-6.7 2 .2 2.5 2.3 1.2 3.9-1.1 1.4-3.2 2.4-5.9 2.8' }),
        h('circle', { cx: 8.1, cy: 8.3, r: 1, fill: color, stroke: 'none' }),
        h('circle', { cx: 12, cy: 7.1, r: 1, fill: color, stroke: 'none' }),
        h('circle', { cx: 15.9, cy: 8.3, r: 1, fill: color, stroke: 'none' }),
      );
    }

    function gradientId(id) {
      return `abaaba-${id}`;
    }

    function paintValue(value) {
      if (typeof value !== 'string') return 'none';
      const match = /^url\(#([A-Za-z][A-Za-z0-9_-]{0,63})\)$/.exec(value);
      return match ? `url(#${gradientId(match[1])})` : value;
    }

    function renderGradient(gradient, index) {
      const stops = gradient.stops.map((stop, stopIndex) => h('stop', {
        key: stopIndex,
        offset: `${Math.round(stop.offset * 1000) / 10}%`,
        stopColor: stop.color,
        stopOpacity: stop.opacity,
      }));
      if (gradient.kind === 'radial') {
        return h('radialGradient', {
          key: `g-${index}`,
          id: gradientId(gradient.id),
          cx: gradient.cx,
          cy: gradient.cy,
          r: gradient.r,
          gradientUnits: 'userSpaceOnUse',
        }, stops);
      }
      return h('linearGradient', {
        key: `g-${index}`,
        id: gradientId(gradient.id),
        x1: gradient.x1,
        y1: gradient.y1,
        x2: gradient.x2,
        y2: gradient.y2,
        gradientUnits: 'userSpaceOnUse',
      }, stops);
    }

    function commonProps(element) {
      return {
        fill: paintValue(element.fill),
        stroke: paintValue(element.stroke),
        strokeWidth: element.strokeWidth,
        strokeLinecap: element.strokeLinecap,
        strokeLinejoin: element.strokeLinejoin,
        opacity: element.opacity,
      };
    }

    function renderElement(element, index) {
      const key = `e-${index}`;
      if (element.type === 'rect') {
        return h('rect', {
          key, x: element.x, y: element.y, width: element.w, height: element.h,
          rx: element.rx || undefined, ...commonProps(element),
        });
      }
      if (element.type === 'circle') {
        return h('circle', { key, cx: element.cx, cy: element.cy, r: element.r, ...commonProps(element) });
      }
      if (element.type === 'ellipse') {
        return h('ellipse', { key, cx: element.cx, cy: element.cy, rx: element.rx, ry: element.ry, ...commonProps(element) });
      }
      if (element.type === 'line') {
        return h('line', { key, x1: element.x1, y1: element.y1, x2: element.x2, y2: element.y2, ...commonProps(element) });
      }
      if (element.type === 'path') {
        return h('path', { key, d: element.d, ...commonProps(element) });
      }
      if (element.type === 'polygon') {
        return h('polygon', { key, points: element.points, ...commonProps(element) });
      }
      if (element.type === 'text') {
        return h('text', {
          key,
          x: element.x,
          y: element.y,
          fontFamily: element.font === 'sans'
            ? "Inter, 'Segoe UI', Arial, sans-serif"
            : element.font === 'mono'
              ? "'Cascadia Code', 'SFMono-Regular', Consolas, monospace"
              : "Georgia, 'Times New Roman', serif",
          fontSize: element.size,
          fontWeight: element.weight,
          textAnchor: element.anchor,
          letterSpacing: element.letterSpacing || undefined,
          xmlSpace: 'preserve',
          ...commonProps(element),
        }, element.text);
      }
      return null;
    }

    const CanvasSvg = React.memo(function CanvasSvg({ state, t }) {
      const gradients = state.elements.filter((element) => element.type === 'gradient');
      const shapes = state.elements.filter((element) => element.type !== 'gradient');
      return h('svg', {
        viewBox: `0 0 ${state.width} ${state.height}`,
        preserveAspectRatio: 'xMidYMid meet',
        role: 'img',
        'aria-label': t('panel.ariaCanvas'),
      },
        h('title', null, state.title),
        gradients.length > 0 ? h('defs', null, gradients.map(renderGradient)) : null,
        h('rect', { x: 0, y: 0, width: state.width, height: state.height, fill: state.background }),
        shapes.map(renderElement),
      );
    });

    function CanvasStage({ state, t, fullscreen, setFullscreen }) {
      const viewportRef = useRef(null);
      const dragRef = useRef(null);
      const userAdjustedRef = useRef(false);
      const [scale, setScale] = useState(1);
      const [offset, setOffset] = useState({ x: 0, y: 0 });
      const clampScale = (value) => Math.min(8, Math.max(0.1, value));

      const fit = useCallback((force = false) => {
        if (!force && userAdjustedRef.current) return;
        const viewport = viewportRef.current;
        if (!viewport) return;
        const padding = fullscreen ? 0 : 36;
        const availableWidth = Math.max(80, viewport.clientWidth - padding);
        const availableHeight = Math.max(80, viewport.clientHeight - padding);
        setScale(Math.min(8, Math.max(0.02, Math.min(availableWidth / state.width, availableHeight / state.height))));
        setOffset({ x: 0, y: 0 });
      }, [state.width, state.height, fullscreen]);

      useEffect(() => {
        userAdjustedRef.current = false;
        fit(true);
      }, [state.width, state.height]);

      useEffect(() => {
        fit();
        const viewport = viewportRef.current;
        if (!viewport || typeof ResizeObserver === 'undefined') return undefined;
        const observer = new ResizeObserver(() => fit());
        observer.observe(viewport);
        return () => observer.disconnect();
      }, [fit]);

      useEffect(() => {
        fit();
      }, [fullscreen]);

      useEffect(() => {
        if (!fullscreen) return undefined;
        const previousOverflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        return () => { document.body.style.overflow = previousOverflow; };
      }, [fullscreen]);

      useEffect(() => {
        const viewport = viewportRef.current;
        if (!viewport) return undefined;
        const onWheel = (event) => {
          if (!(event.ctrlKey || event.metaKey)) return;
          if (event.deltaY === 0) return;
          event.preventDefault();
          userAdjustedRef.current = true;
          setScale((value) => clampScale(value * (event.deltaY < 0 ? 1.12 : 0.89)));
        };
        viewport.addEventListener('wheel', onWheel, { passive: false });
        return () => viewport.removeEventListener('wheel', onWheel);
      }, []);

      useEffect(() => {
        if (!fullscreen) return undefined;
        const onKey = (event) => {
          if (event.key === 'Escape' && !event.defaultPrevented) setFullscreen(false);
        };
        window.addEventListener('keydown', onKey, true);
        return () => window.removeEventListener('keydown', onKey, true);
      }, [fullscreen, setFullscreen]);

      const zoomBy = (factor) => {
        userAdjustedRef.current = true;
        setScale((value) => clampScale(value * factor));
      };

      return h('div', {
        className: 'abaaba-viewport',
        ref: viewportRef,
        role: 'region',
        'aria-label': t('panel.ariaCanvas'),
        onPointerDown: (event) => {
          if (event.button !== 0 || !event.isPrimary || dragRef.current) return;
          userAdjustedRef.current = true;
          dragRef.current = {
            id: event.pointerId,
            x: event.clientX,
            y: event.clientY,
            ox: offset.x,
            oy: offset.y,
          };
          try {
            if (event.currentTarget.setPointerCapture) event.currentTarget.setPointerCapture(event.pointerId);
          } catch {
            dragRef.current = null;
          }
        },
        onPointerMove: (event) => {
          const drag = dragRef.current;
          if (!drag || drag.id !== event.pointerId || (event.buttons & 1) === 0) return;
          setOffset({ x: drag.ox + event.clientX - drag.x, y: drag.oy + event.clientY - drag.y });
        },
        onPointerUp: (event) => {
          if (dragRef.current && dragRef.current.id === event.pointerId) dragRef.current = null;
        },
        onPointerCancel: () => {
          dragRef.current = null;
        },
        onLostPointerCapture: () => {
          dragRef.current = null;
        },
      },
        h('div', {
          className: 'abaaba-canvas',
          style: {
            width: Math.max(1, Math.round(state.width * scale)),
            height: Math.max(1, Math.round(state.height * scale)),
            transform: `translate(-50%, -50%) translate(${offset.x}px, ${offset.y}px)`,
          },
        }, h(CanvasSvg, { state, t })),
        state.count === 0 ? h('div', { className: 'abaaba-empty' },
          h('strong', null, t('panel.empty')),
          h('span', null, t('panel.emptyHint')),
        ) : null,
        h('div', { className: 'abaaba-zoom', role: 'group', 'aria-label': t('panel.ariaToolbar'), onPointerDown: (event) => event.stopPropagation() },
          h('button', { type: 'button', className: 'abaaba-zoom-btn', onClick: () => zoomBy(0.9), title: t('panel.zoomOut'), 'aria-label': t('panel.zoomOut') }, '−'),
          h('span', { className: 'abaaba-zoom-label', 'aria-live': 'polite' }, `${Math.round(scale * 100)}%`),
          h('button', { type: 'button', className: 'abaaba-zoom-btn', onClick: () => zoomBy(1.12), title: t('panel.zoomIn'), 'aria-label': t('panel.zoomIn') }, '+'),
          h('button', { type: 'button', className: 'abaaba-zoom-btn wide', onClick: () => { userAdjustedRef.current = false; fit(true); }, title: t('panel.fit'), 'aria-label': t('panel.fit') }, t('panel.fit')),
          h('button', { type: 'button', className: 'abaaba-zoom-btn wide', onClick: () => { userAdjustedRef.current = true; setScale(1); setOffset({ x: 0, y: 0 }); }, title: t('panel.zoom100'), 'aria-label': t('panel.zoom100') }, '100%'),
          h('button', { type: 'button', className: 'abaaba-zoom-btn wide', onClick: () => setFullscreen(!fullscreen), title: fullscreen ? t('panel.exitFull') : t('panel.full'), 'aria-label': fullscreen ? t('panel.exitFull') : t('panel.full'), 'aria-pressed': fullscreen }, fullscreen ? t('panel.exitFull') : t('panel.full')),
        ),
      );
    }

    function PaintPanelSession(props) {
      if (typeof props.useSessions !== 'function') return h(PaintPanel, { ...props, sessionId: null });
      return h(PaintPanelBound, props);
    }

    function PaintPanelBound({ useSessions, ...props }) {
      const currentSessionId = useSessions((value) => value?.current ?? null);
      return h(PaintPanel, { ...props, sessionId: currentSessionId ?? null });
    }

    function PaintPanel({ ctx, sessionId }) {
      const t = useMemo(() => tFactory(ctx), [ctx]);
      const [state, setState] = useState(null);
      const [error, setError] = useState('');
      const [busy, setBusy] = useState(false);
      const [online, setOnline] = useState(true);
      const [showHandoffs, setShowHandoffs] = useState(false);
      const [handoffs, setHandoffs] = useState(null);
      const [handoffError, setHandoffError] = useState('');
      const [fullscreen, setFullscreen] = useState(false);
      const etagRef = useRef(null);
      const requestSeqRef = useRef(0);
      const sessionIdRef = useRef(sessionId);
      sessionIdRef.current = sessionId;

      const load = useCallback(async () => {
        if (!sessionId) return;
        if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
        const targetSession = sessionId;
        const seq = ++requestSeqRef.current;
        try {
          const response = await fetch(`api/abaaba-paint/state?sessionId=${encodeURIComponent(targetSession)}`, {
            cache: 'no-store',
            headers: etagRef.current ? { 'if-none-match': etagRef.current } : undefined,
          });
          if (seq !== requestSeqRef.current || sessionIdRef.current !== targetSession) return;
          if (response.status === 304) {
            setOnline(true);
            setError('');
            return;
          }
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          const data = await response.json();
          if (seq !== requestSeqRef.current || sessionIdRef.current !== targetSession) return;
          if (!data || data.ok !== true || !data.value) throw new Error('invalid state');
          const nextEtag = response.headers.get('etag');
          if (nextEtag) etagRef.current = nextEtag;
          setState((previous) => previous && previous.revision === data.value.revision ? previous : data.value);
          setOnline(true);
          setError('');
        } catch (loadError) {
          if (seq !== requestSeqRef.current || sessionIdRef.current !== targetSession) return;
          setOnline(false);
          setError(t('panel.error', { message: loadError instanceof Error ? loadError.message : String(loadError) }));
        }
      }, [sessionId, t]);

      useEffect(() => {
        requestSeqRef.current += 1;
        setState(null);
        etagRef.current = null;
        setError('');
        setShowHandoffs(false);
        setHandoffs(null);
        setHandoffError('');
        setFullscreen(false);
        setBusy(false);
      }, [sessionId]);

      useEffect(() => {
        if (!sessionId) return undefined;
        let alive = true;
        const tick = () => {
          if (alive) void load();
        };
        tick();
        const timer = setInterval(tick, 1200);
        return () => {
          alive = false;
          clearInterval(timer);
        };
      }, [load, sessionId]);

      const runAction = useCallback(async (action, extra = {}) => {
        if (!state || busy) return;
        const targetSession = sessionId;
        setBusy(true);
        setError('');
        try {
          const response = await fetch('api/abaaba-paint/action', {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              'x-abaaba-paint': '1',
            },
            body: JSON.stringify({ action, revision: state.revision, sessionId: targetSession, ...extra }),
          });
          const data = await response.json().catch(() => null);
          if (sessionIdRef.current !== targetSession) return;
          if (response.status === 409 || (data && data.code === 'PAINT_STALE')) {
            setError(t('panel.stale'));
            await load();
            return;
          }
          if (!response.ok || !data || data.ok !== true) {
            throw new Error((data && data.message) || `HTTP ${response.status}`);
          }
          await load();
        } catch (actionError) {
          if (sessionIdRef.current !== targetSession) return;
          setError(t('panel.error', { message: actionError instanceof Error ? actionError.message : String(actionError) }));
        } finally {
          setBusy(false);
        }
      }, [busy, load, sessionId, state, t]);

      const saveSvg = useCallback(async () => {
        try {
          const response = await fetch(`api/abaaba-paint/export.svg?sessionId=${encodeURIComponent(sessionId)}`, { cache: 'no-store' });
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          const blob = await response.blob();
          const url = URL.createObjectURL(blob);
          const anchor = document.createElement('a');
          anchor.href = url;
          anchor.download = `abaaba-paint-${state ? state.revision : 'canvas'}.svg`;
          anchor.rel = 'noopener';
          document.body.appendChild(anchor);
          anchor.click();
          anchor.remove();
          setTimeout(() => URL.revokeObjectURL(url), 1500);
          setError('');
        } catch (saveError) {
          setError(t('panel.error', { message: saveError instanceof Error ? saveError.message : String(saveError) }));
        }
      }, [sessionId, state, t]);

      const loadHandoffs = useCallback(async () => {
        if (!sessionId) return;
        const targetSession = sessionId;
        setHandoffError('');
        try {
          const response = await fetch(`api/abaaba-paint/handoffs?sessionId=${encodeURIComponent(targetSession)}`, { cache: 'no-store' });
          const data = await response.json().catch(() => null);
          if (sessionIdRef.current !== targetSession) return;
          if (!response.ok || !data || data.ok !== true) throw new Error((data && data.message) || `HTTP ${response.status}`);
          setHandoffs(Array.isArray(data.artifacts) ? data.artifacts : []);
        } catch (handoffLoadError) {
          if (sessionIdRef.current !== targetSession) return;
          setHandoffError(t('panel.handoffFailed', { message: handoffLoadError instanceof Error ? handoffLoadError.message : String(handoffLoadError) }));
        }
      }, [sessionId, t]);

      useEffect(() => {
        if (showHandoffs) void loadHandoffs();
      }, [loadHandoffs, showHandoffs]);

      const importHandoff = useCallback((artifactId) => {
        if (!window.confirm(t('panel.handoffConfirm'))) return;
        setShowHandoffs(false);
        void runAction('import', { artifactId, replace: true });
      }, [runAction, t]);

      if (!sessionId) {
        return h('div', { className: `abaaba-panel${fullscreen ? ' abaaba-full' : ''}` },
          h('style', null, CSS),
          h('div', { className: 'abaaba-stage' }, h('span', { className: 'abaaba-subtitle' }, t('panel.noSession'))),
        );
      }

      if (!state) {
        return h('div', { className: `abaaba-panel${fullscreen ? ' abaaba-full' : ''}` },
          h('style', null, CSS),
          h('div', { className: 'abaaba-stage' }, h('span', { className: 'abaaba-subtitle' }, t('panel.loading'))),
        );
      }

      const updated = state.updatedAt ? new Date(state.updatedAt).toLocaleTimeString() : '—';
      const saveTime = state.savedAt ? new Date(state.savedAt).toLocaleTimeString() : '—';
      const persistence = !state.workspace
        ? t('panel.unbound')
        : state.saveError
          ? t('panel.saveFailed', { message: state.saveError })
          : state.persisted
            ? t('panel.saved', { time: saveTime })
            : t('panel.savedAt', { time: saveTime });
      return h('div', { className: `abaaba-panel${fullscreen ? ' abaaba-full' : ''}` },
        h('style', null, CSS),
        h('header', { className: 'abaaba-header' },
          h('div', { className: 'abaaba-heading' },
            h('h1', { className: 'abaaba-title' }, state.title || t('panel.title')),
            h('p', { className: 'abaaba-subtitle' }, t('panel.subtitle')),
          ),
          h('div', { className: 'abaaba-toolbar', role: 'toolbar', 'aria-label': t('panel.ariaToolbar') },
            h('div', { className: 'abaaba-meta' },
              h('span', { className: `abaaba-dot${online ? '' : ' offline'}` }),
              h('span', null, online ? t('status.live') : t('status.offline')),
            ),
            h('button', { type: 'button', className: 'abaaba-btn', onClick: () => setShowHandoffs((value) => !value), disabled: busy }, t('panel.handoff')),
            h('button', { type: 'button', className: 'abaaba-btn', onClick: () => void load(), disabled: busy }, t('panel.refresh')),
            h('button', { type: 'button', className: 'abaaba-btn', onClick: () => void runAction('undo'), disabled: busy }, t('panel.undo')),
            h('button', { type: 'button', className: 'abaaba-btn', onClick: () => { if (window.confirm(t('panel.confirmClear'))) void runAction('clear'); }, disabled: busy || state.count === 0 }, t('panel.clear')),
            h('button', { type: 'button', className: 'abaaba-btn', onClick: () => void runAction('save'), disabled: busy || !state.workspace }, t('panel.saveWorkspace')),
            h('button', { type: 'button', className: 'abaaba-btn', onClick: () => void runAction('reload'), disabled: busy || !state.workspace }, t('panel.reload')),
            h('button', { type: 'button', className: 'abaaba-btn primary', onClick: () => void saveSvg(), disabled: busy }, t('panel.save')),
          ),
        ),
        showHandoffs ? h('div', { className: 'abaaba-handoffs' },
          h('div', { className: 'abaaba-handoff-head' },
            h('strong', { className: 'abaaba-handoff-title' }, t('panel.handoffTitle')),
            h('button', { type: 'button', className: 'abaaba-btn', onClick: () => setShowHandoffs(false) }, t('panel.handoff')),
          ),
          handoffError ? h('div', { className: 'abaaba-handoff-error', role: 'alert' }, handoffError) : null,
          handoffs === null && !handoffError ? h('div', { className: 'abaaba-handoff-empty' }, t('panel.handoffLoading')) : null,
          handoffs !== null && handoffs.length === 0 ? h('div', { className: 'abaaba-handoff-empty' }, t('panel.handoffEmpty')) : null,
          handoffs !== null && handoffs.length > 0 ? h('div', { className: 'abaaba-handoff-list' },
            handoffs.map((item) => h('div', { className: 'abaaba-handoff-card', key: item.artifactId },
              h('img', {
                className: 'abaaba-handoff-thumb',
                src: `api/abaaba-paint/handoff.svg?sessionId=${encodeURIComponent(sessionId)}&artifactId=${encodeURIComponent(item.artifactId)}`,
                alt: item.title,
              }),
              h('div', { className: 'abaaba-handoff-copy' },
                h('span', { className: 'abaaba-handoff-name', title: item.title }, item.title),
                h('span', { className: 'abaaba-handoff-meta' }, t('panel.handoffMeta', { width: item.width, height: item.height, count: item.count })),
                h('span', { className: 'abaaba-handoff-meta' }, t('panel.handoffSource', { source: item.source && (item.source.name || item.source.agentId) || '—' })),
              ),
              h('button', { type: 'button', className: 'abaaba-btn primary', onClick: () => importHandoff(item.artifactId) }, t('panel.handoffImport')),
            )),
          ) : null,
        ) : null,
        error ? h('div', { className: 'abaaba-alert', role: 'alert' }, error) : null,
        h('div', { className: 'abaaba-stage' }, h(CanvasStage, { state, t, fullscreen, setFullscreen })),
        h('footer', { className: 'abaaba-footer' },
          h('span', null, busy ? t('panel.busy') : `${t('panel.revision', { revision: state.revision })} · ${t('panel.elements', { count: state.count })}`),
          h('span', { className: state.saveError ? 'abaaba-save-error' : 'abaaba-persistence', title: state.workspace || undefined }, persistence),
          h('span', null, t('panel.updated', { time: updated })),
        ),
      );
    }

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        const t = tFactory(ctx);
        ctx.effect(() => {
          const disposers = [
            ctx.locale.register(NS, 'zh', DICT.zh),
            ctx.locale.register(NS, 'en', DICT.en),
          ];
          return () => {
            for (const dispose of disposers) dispose();
          };
        });
        ctx.effect(() => ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
          name: 'sidebar.panellist',
          id: 'abaaba-paint',
          order: 30,
          label: () => t('panel.title'),
        }, PaintIcon)));
        ctx.effect(() => ctx.slots.inject('main', () => ctx.slots.register({
          name: 'main',
          key: 'abaaba-paint',
        }, (props) => h(PaintPanelSession, { ...props, ctx }))));
        ctx.effect(() => ctx.slots.inject('conversation.view', () => ctx.slots.register({
          name: 'conversation.view',
          id: 'abaaba-paint',
          order: 40,
          label: () => t('panel.title'),
        }, (props) => h(PaintPanelSession, { ...props, ctx }))));
      },
    };
  },
});
