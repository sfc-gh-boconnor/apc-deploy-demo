# -*- coding: utf-8 -*-
import os
import streamlit as st
import pandas as pd

DATABASE = os.environ.get("SNOWFLAKE_DATABASE", "APC_DEPLOY_DB")
WAREHOUSE = os.environ.get("SNOWFLAKE_WAREHOUSE", "APC_DEPLOY_WH")
import plotly.express as px
import plotly.graph_objects as go

st.set_page_config(
    page_title="AI Product Costing Accelerator",
    page_icon="💊",
    layout="wide",
    initial_sidebar_state="collapsed",
)

# ── Global CSS — match React app styling ─────────────────────────────────────
st.markdown("""
<style>
/* Font stack matching React app */
html, body, [class*="css"] {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif !important;
}

/* Hide Streamlit chrome */
#MainMenu { visibility: hidden; }
footer { visibility: hidden; }
.stDeployButton { display: none; }
header[data-testid="stHeader"] { background: transparent; }

/* Main content padding */
.block-container { padding-top: 0 !important; max-width: 100% !important; }

/* Tabs — match React tab style */
.stTabs [data-baseweb="tab-list"] {
    background: #ffffff;
    border-bottom: 1px solid #e2e8f0;
    gap: 0;
    padding: 0 8px;
}
.stTabs [data-baseweb="tab"] {
    font-size: .82rem;
    font-weight: 500;
    color: #64748b;
    border-bottom: 2px solid transparent;
    padding: 12px 18px;
    background: transparent !important;
}
.stTabs [aria-selected="true"] {
    color: #29b5e8 !important;
    border-bottom: 2px solid #29b5e8 !important;
    font-weight: 600 !important;
}
.stTabs [data-baseweb="tab-highlight"] { display: none; }
.stTabs [data-baseweb="tab-border"] { display: none; }

/* Cards — match React .card */
[data-testid="stVerticalBlock"] > [data-testid="element-container"] > div {
    border-radius: 0;
}
div[data-testid="metric-container"] {
    background: #ffffff;
    border: 1px solid #e2e8f0;
    border-radius: 10px;
    padding: 16px 18px;
    box-shadow: 0 1px 4px rgba(0,0,0,.08);
}
div[data-testid="metric-container"] label {
    font-size: .72rem !important;
    text-transform: uppercase;
    letter-spacing: .5px;
    color: #64748b !important;
    font-weight: 500;
}
div[data-testid="metric-container"] [data-testid="stMetricValue"] {
    font-size: 1.5rem !important;
    font-weight: 700 !important;
    color: #1e293b !important;
}

/* Buttons — Cortex Blue */
.stButton > button {
    background: #29b5e8 !important;
    color: white !important;
    border: none !important;
    border-radius: 8px !important;
    font-weight: 600 !important;
    font-size: .82rem !important;
}
.stButton > button:hover { opacity: .9 !important; }

/* Selectbox / slider labels */
.stSelectbox label, .stSlider label {
    font-size: .82rem !important;
    font-weight: 500 !important;
    color: #1e293b !important;
}

/* Subheaders */
h3 {
    font-size: .95rem !important;
    font-weight: 600 !important;
    color: #1e293b !important;
    margin-bottom: 12px !important;
}

/* Data table — match React .data-table */
.apc-tbl-wrap { border: 1px solid #e2e8f0; border-radius: 10px; overflow: hidden; margin-bottom: 12px; }
table.apc-tbl { width: 100%; border-collapse: collapse; font-size: .82rem;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }
table.apc-tbl th { text-align: left; padding: 8px 12px; background: #f8fafc;
  font-size: .72rem; text-transform: uppercase; letter-spacing: .5px;
  color: #64748b; border-bottom: 2px solid #e2e8f0; font-weight: 600; white-space: nowrap; }
table.apc-tbl td { padding: 10px 12px; border-bottom: 1px solid #e2e8f0; color: #1e293b; }
table.apc-tbl tbody tr:last-child td { border-bottom: none; }
table.apc-tbl tbody tr:hover td { background: #f8fafc; }
.var-pos { color: #ef4444; font-weight: 600; }
.var-neg { color: #10b981; font-weight: 600; }
.var-warn { color: #f59e0b; font-weight: 600; }

/* Chat bubbles (match React ChatPanel) */
.chat-msg { display: flex; margin: 10px 0; }
.chat-msg.user { justify-content: flex-end; }
.chat-msg.assistant { justify-content: flex-start; }
.chat-bubble {
  max-width: 80%;
  padding: 10px 14px;
  border-radius: 12px;
  font-size: .85rem;
  line-height: 1.55;
}
.chat-msg.user .chat-bubble {
  background: #29b5e8; color: #fff; border-bottom-right-radius: 3px;
}
.chat-msg.assistant .chat-bubble {
  background: #f8fafc; color: #1e293b;
  border: 1px solid #e2e8f0; border-bottom-left-radius: 3px;
}
.chat-bubble p { margin: 0 0 8px 0; }
.chat-bubble p:last-child { margin-bottom: 0; }
.chat-bubble ul, .chat-bubble ol { margin: 4px 0 8px 0; padding-left: 20px; }
.chat-bubble li { margin: 2px 0; }
.chat-bubble strong { font-weight: 700; }
.chat-bubble code { background: #eef2f7; padding: 1px 5px; border-radius: 4px; font-size: .8rem; }
</style>
""", unsafe_allow_html=True)

# ── Connection ──────────────────────────────────────────────────────────────
from snowflake.snowpark.context import get_active_session
session = get_active_session()

@st.cache_data(ttl=120)
def query(sql):
    return session.sql(sql).to_pandas()

def styled_table(df: pd.DataFrame, fmt: dict = None, variance_cols: list = None) -> str:
    """Render a DataFrame as an HTML table matching the React .data-table style."""
    df = df.copy()
    if fmt:
        for col, f in fmt.items():
            if col in df.columns:
                df[col] = df[col].apply(
                    lambda x, f=f: f.format(x) if (x is not None and x == x) else ""
                )
    variance_cols = variance_cols or []
    headers = "".join(f"<th>{col}</th>" for col in df.columns)
    rows = []
    for _, row in df.iterrows():
        cells = []
        for col in df.columns:
            val = row[col]
            css = ""
            if col in variance_cols:
                try:
                    num = float(str(val).replace("%", "").replace("+", "").replace("$", "").replace(",", ""))
                    if abs(num) > 5:  css = ' class="var-pos"' if num > 0 else ' class="var-neg"'
                    elif abs(num) > 2: css = ' class="var-warn"'
                    elif num < 0:     css = ' class="var-neg"'
                except Exception:
                    pass
            cells.append(f"<td{css}>{val}</td>")
        rows.append("<tr>" + "".join(cells) + "</tr>")
    return (
        '<div class="apc-tbl-wrap">'
        '<table class="apc-tbl">'
        f"<thead><tr>{headers}</tr></thead>"
        f"<tbody>{''.join(rows)}</tbody>"
        "</table></div>"
    )

# ── Chat helpers (match React ChatPanel) ──────────────────────────────────────
import re, json as _json
try:
    import markdown as _md
    def _md_to_html(text: str) -> str:
        return _md.markdown(text, extensions=["tables", "sane_lists"])
except Exception:
    def _md_to_html(text: str) -> str:
        # Minimal fallback: bold, inline code, paragraphs
        t = re.sub(r"\*\*(.+?)\*\*", r"<strong>\1</strong>", text)
        t = re.sub(r"`(.+?)`", r"<code>\1</code>", t)
        return "".join(f"<p>{ln}</p>" for ln in t.split("\n\n") if ln.strip())

def _clean_answer(raw: str) -> str:
    """AI_COMPLETE sometimes returns a JSON-quoted / escaped string. Unwrap it."""
    if raw is None:
        return ""
    ans = str(raw).strip()
    if len(ans) >= 2 and ans[0] == '"' and ans[-1] == '"':
        try:
            ans = _json.loads(ans)
        except Exception:
            ans = ans[1:-1]
    return ans.replace("\\n", "\n").strip()

def _parse_chart(content: str):
    """Extract a <chart type=".." title=".."> JSON </chart> block. Returns (text, spec|None)."""
    m = re.search(r'<chart\s+type="(\w+)"\s+title="([^"]*)">\s*([\s\S]*?)\s*</chart>', content)
    if not m:
        return content, None
    full, ctype, title, body = m.group(0), m.group(1), m.group(2), m.group(3)
    try:
        data = _json.loads(body)
        if not isinstance(data, list):
            return content, None
    except Exception:
        return content.replace(full, "").strip(), None
    return content.replace(full, "").strip(), {"type": ctype, "title": title, "data": data}

def render_bubble(role: str, text: str):
    inner = _md_to_html(text) if role == "assistant" else (
        text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;"))
    st.markdown(
        f'<div class="chat-msg {role}"><div class="chat-bubble">{inner}</div></div>',
        unsafe_allow_html=True,
    )

def render_chat_chart(spec: dict, key: str = "chat_chart"):
    import plotly.graph_objects as go
    data = spec.get("data") or []
    title = spec.get("title", ""); ctype = spec["type"]
    PALETTE = ["#29b5e8", "#8b5cf6", "#f59e0b", "#10b981", "#ef4444", "#6366f1"]
    if not data:
        return

    def _num(v):
        try:
            return float(v)
        except Exception:
            return None

    if ctype == "map":
        names = [d.get("name", "") for d in data]
        lats  = [_num(d.get("lat")) for d in data]
        lons  = [_num(d.get("lng")) for d in data]
        vals  = [_num(d.get("value")) or 0 for d in data]
        def _mc(v):
            return "#ef4444" if v > 8 else "#f59e0b" if v > 5 else "#10b981" if v < -1 else "#29b5e8"
        fig = go.Figure(go.Scattergeo(
            lon=lons, lat=lats, text=[f"{n}: {v:+.1f}%" for n, v in zip(names, vals)],
            mode="markers+text", textposition="top center",
            marker=dict(size=[max(10, 10 + abs(v) * 1.6) for v in vals],
                        color=[_mc(v) for v in vals], line=dict(width=1, color="#fff"), opacity=.85),
        ))
        fig.update_geos(showcountries=True, countrycolor="#cbd5e1",
                        showland=True, landcolor="#eef2f7", showocean=True, oceancolor="#f8fafc",
                        projection_type="natural earth")
        fig.update_layout(title=title, height=340, margin=dict(l=0, r=0, t=36, b=0),
                          paper_bgcolor="#ffffff")
        st.plotly_chart(fig, use_container_width=True, key=key)
        return

    names = [str(d.get("name", "")) for d in data]
    # Determine numeric series. Prefer a single "value" field; otherwise treat every
    # other numeric key (e.g. budget / actual) as its own series -> grouped bars.
    reserved = {"name", "lat", "lng", "plant"}
    series_keys = []
    if any("value" in d for d in data):
        series_keys = ["value"]
    else:
        for d in data:
            for k, v in d.items():
                if k not in reserved and k not in series_keys and _num(v) is not None:
                    series_keys.append(k)

    def _series(k):
        return [_num(d.get(k)) for d in data]

    if ctype == "pie" and series_keys:
        fig = go.Figure(go.Pie(labels=names, values=_series(series_keys[0]), hole=.35,
                               marker=dict(colors=PALETTE)))
    elif ctype == "line":
        fig = go.Figure()
        for si, k in enumerate(series_keys):
            fig.add_trace(go.Scatter(x=names, y=_series(k), mode="lines+markers",
                                     name=k.title(), connectgaps=True,
                                     line=dict(color=PALETTE[si % len(PALETTE)], width=2.5),
                                     marker=dict(size=7)))
    else:  # bar (single or grouped)
        fig = go.Figure()
        if len(series_keys) <= 1:
            k = series_keys[0] if series_keys else "value"
            fig.add_trace(go.Bar(x=names, y=_series(k),
                                 marker=dict(color=[PALETTE[i % len(PALETTE)] for i in range(len(names))])))
        else:
            for si, k in enumerate(series_keys):
                fig.add_trace(go.Bar(x=names, y=_series(k), name=k.title(),
                                     marker=dict(color=PALETTE[si % len(PALETTE)])))
            fig.update_layout(barmode="group")

    multi = len(series_keys) > 1
    fig.update_layout(title=title, height=280, margin=dict(l=10, r=10, t=40, b=10),
                      paper_bgcolor="#ffffff", plot_bgcolor="#ffffff",
                      font=dict(size=11, color="#1e293b"),
                      showlegend=(ctype == "pie" or multi or ctype == "line"))
    if ctype != "pie":
        fig.update_xaxes(showgrid=False)
        fig.update_yaxes(gridcolor="#e2e8f0")
    st.plotly_chart(fig, use_container_width=True, key=key)


# ── Header ───────────────────────────────────────────────────────────────────
st.markdown("""
<div style="background:linear-gradient(135deg,#0d2b45 0%,#11567f 100%);padding:14px 24px;margin:-1rem -1rem 1rem -1rem;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid #1e3a5f">
  <div>
    <span style="font-size:1rem;font-weight:700;color:#ffffff;letter-spacing:-.3px">AI Product Costing Accelerator</span>
    <div style="font-size:.72rem;color:rgba(255,255,255,.65);margin-top:2px">SAP BW + SAP BDC Connect + Snowflake Cortex AI</div>
  </div>
  <span style="background:rgba(41,181,232,.2);border:1px solid rgba(41,181,232,.4);color:#29b5e8;font-size:.68rem;padding:3px 10px;border-radius:20px;font-weight:600;letter-spacing:.3px">
    SAP BW → BDC Connect — Zero Copy · No ETL
  </span>
</div>
""", unsafe_allow_html=True)

# ── Tabs ─────────────────────────────────────────────────────────────────────
tabs = st.tabs(["Variance Analysis", "Scenario Analysis",
                "Profitability", "Sales Forecast", "Smart Insights", "Ask Cortex AI",
                "Data Engineering", "Observability & Trust"])

with tabs[0]:
    _PMAP = {1:"Jan",2:"Feb",3:"Mar",4:"Apr",5:"May",6:"Jun"}

    def _plabel(p):
        try: return _PMAP.get(int(p), str(p))
        except: return str(p)

    def _var_color(v):
        if v > 5:  return "#ef4444"
        if v > 2:  return "#f59e0b"
        if v < -2: return "#10b981"
        return "#29b5e8"

    def pivot_heatmap(df, row_col, col_col, val_col, col_order=None):
        rows = sorted(df[row_col].unique())
        cols = col_order if col_order else sorted(df[col_col].unique())
        lookup = {}
        for _, r in df.iterrows():
            lookup[(r[row_col], r[col_col])] = r[val_col]
        ths = "".join(f"<th style='text-align:center'>{c}</th>" for c in cols)
        trs = []
        for rv in rows:
            cells = [f"<td style='padding:8px 12px;font-size:.78rem;font-family:monospace'>{rv}</td>"]
            for cv in cols:
                v = lookup.get((rv, cv))
                if v is not None:
                    bg = ("background:rgba(239,68,68,0.18)" if v > 5
                          else "background:rgba(245,158,11,0.18)" if v > 2
                          else "background:rgba(16,185,129,0.18)" if v < -2
                          else "")
                    fc = "#ef4444" if v > 2 else "#10b981" if v < -2 else "#1e293b"
                    sign = "+" if v > 0 else ""
                    cells.append(f"<td style='text-align:center;font-size:.83rem;font-weight:600;{bg};padding:8px 10px'>"
                                 f"<span style='color:{fc}'>{sign}{v:.1f}%</span></td>")
                else:
                    cells.append("<td style='text-align:center;color:#cbd5e1;padding:8px 10px'>—</td>")
            trs.append("<tr>" + "".join(cells) + "</tr>")
        return ('<div class="apc-tbl-wrap" style="overflow-x:auto">'
                '<table class="apc-tbl">'
                f'<thead><tr><th>Product</th>{ths}</tr></thead>'
                f'<tbody>{"".join(trs)}</tbody>'
                '</table></div>')

    # ── Filter bar ──────────────────────────────────────────────────────────
    fc1, fc2, fc3 = st.columns(3)
    with fc1:
        _site_df = query(f"SELECT DISTINCT PLANT_NAME FROM {DATABASE}.ANALYTICS.PRODUCT_COST_SUMMARY ORDER BY 1")
        site_fv = st.selectbox("Manufacturing Site", ["All Sites"] + _site_df["PLANT_NAME"].tolist(), key="vf_site")
    with fc2:
        _per_opts = {"All Periods": None, "Period 1 — Jan": 1, "Period 2 — Feb": 2,
                     "Period 3 — Mar": 3, "Period 4 — Apr": 4, "Period 5 — May": 5, "Period 6 — Jun": 6}
        per_fv = _per_opts[st.selectbox("Period", list(_per_opts.keys()), key="vf_period")]
    with fc3:
        _mat_opts = {"Finished Products": "FERT", "Semi-Finished": "HALB", "Raw Materials": "ROH"}
        mat_fv = _mat_opts[st.selectbox("Material Type", list(_mat_opts.keys()), key="vf_type")]

    _wv = f"WHERE FISCAL_YEAR = 2026 AND MATERIAL_TYPE = '{mat_fv}'"
    if site_fv != "All Sites":  _wv += f" AND PLANT_NAME = '{site_fv}'"
    if per_fv:                  _wv += f" AND PERIOD = {per_fv}"

    try:
        # ── Top 10 variance bar chart (full width) ───────────────────────────
        top10 = query(f"""
            SELECT MATERIAL_NUMBER, MATERIAL_DESCRIPTION,
                   ROUND(AVG(COST_VARIANCE_PCT), 2) AS VARIANCE_PCT
            FROM {DATABASE}.ANALYTICS.PRODUCT_COST_SUMMARY
            {_wv}
            GROUP BY 1, 2
            ORDER BY ABS(AVG(COST_VARIANCE_PCT)) DESC
            LIMIT 10
        """)
        if top10.empty:
            st.info("No data for the selected filters.")
        else:
            fig_top = go.Figure(go.Bar(
                x=top10["MATERIAL_DESCRIPTION"], y=top10["VARIANCE_PCT"],
                marker_color=[_var_color(v) for v in top10["VARIANCE_PCT"]],
                marker_line_width=0,
                hovertemplate="%{x}<br>Variance: %{y:+.2f}%<extra></extra>",
            ))
            fig_top.add_hline(y=0, line_dash="dot", line_color="#94a3b8", line_width=1)
            fig_top.update_layout(
                title=dict(text="Cost Variance by Product — Top 10", font=dict(size=13, color="#1e293b")),
                paper_bgcolor="#ffffff", plot_bgcolor="#f8fafc", font_color="#1e293b",
                height=255, margin=dict(t=50, b=70, l=40, r=20),
                xaxis=dict(tickangle=-30, tickfont=dict(size=10)),
                yaxis=dict(ticksuffix="%", gridcolor="#e2e8f0", title="Variance %"),
                annotations=[dict(text="CKMLCR actual vs MBEW standard (SAP BDC)",
                                  showarrow=False, xref="paper", yref="paper",
                                  x=1, y=1.1, xanchor="right",
                                  font=dict(size=10, color="#64748b"))],
            )
            st.plotly_chart(fig_top, use_container_width=True)

            # ── Three charts row ─────────────────────────────────────────────
            ch1, ch2, ch3 = st.columns(3)

            with ch1:
                ytd = query(f"""
                    WITH cp AS (
                        SELECT PERIOD,
                               SUM(STANDARD_COST_PER_UNIT * 1000) AS BUDGET_COST,
                               SUM(ACTUAL_COST_PER_UNIT   * 1000) AS ACTUAL_COST
                        FROM {DATABASE}.ANALYTICS.PRODUCT_COST_SUMMARY
                        WHERE FISCAL_YEAR = 2026 AND MATERIAL_TYPE = '{mat_fv}'
                        GROUP BY PERIOD
                    )
                    SELECT PERIOD,
                           ROUND(BUDGET_COST / 1000, 0) AS BUDGET_K,
                           ROUND(ACTUAL_COST / 1000, 0) AS ACTUAL_K,
                           ROUND((ACTUAL_COST-BUDGET_COST)/NULLIF(BUDGET_COST,0)*100,2) AS VAR_PCT
                    FROM cp ORDER BY PERIOD
                """)
                ytd["PL"] = ytd["PERIOD"].apply(_plabel)
                fig_ytd = go.Figure()
                fig_ytd.add_trace(go.Scatter(x=ytd["PL"], y=ytd["BUDGET_K"], name="Budget",
                    mode="lines+markers", fill="tozeroy",
                    fillcolor="rgba(41,181,232,0.12)", line=dict(color="#29b5e8", width=2),
                    marker=dict(size=5), yaxis="y1"))
                fig_ytd.add_trace(go.Scatter(x=ytd["PL"], y=ytd["ACTUAL_K"], name="Actual",
                    mode="lines+markers", line=dict(color="#ef4444", width=2),
                    marker=dict(size=6), yaxis="y1"))
                fig_ytd.add_trace(go.Bar(x=ytd["PL"], y=ytd["VAR_PCT"], name="Var %",
                    marker_color="#f59e0b", opacity=0.45, yaxis="y2"))
                fig_ytd.update_layout(
                    title=dict(text="YTD Budget vs Actual", font=dict(size=12, color="#1e293b")),
                    paper_bgcolor="#ffffff", plot_bgcolor="#f8fafc", font_color="#1e293b",
                    height=260, margin=dict(t=40, b=50, l=50, r=45),
                    legend=dict(font=dict(size=9), orientation="h", y=-0.25),
                    yaxis=dict(tickprefix="$", ticksuffix="K", gridcolor="#e2e8f0", tickfont=dict(size=9)),
                    yaxis2=dict(ticksuffix="%", overlaying="y", side="right",
                                tickfont=dict(size=9), showgrid=False),
                )
                st.plotly_chart(fig_ytd, use_container_width=True)

            with ch2:
                trd = query("""
                    SELECT PERIOD, ROUND(AVG(COST_VARIANCE_PCT), 2) AS AVG_VAR
                    FROM {DATABASE}.ANALYTICS.PRODUCT_COST_SUMMARY
                    WHERE FISCAL_YEAR = 2026 GROUP BY PERIOD ORDER BY PERIOD
                """)
                trd["PL"] = trd["PERIOD"].apply(_plabel)
                fig_trd = px.line(trd, x="PL", y="AVG_VAR", markers=True,
                                  title="Portfolio Variance Trend",
                                  color_discrete_sequence=["#29b5e8"])
                fig_trd.add_hline(y=0, line_dash="dash", line_color="#94a3b8")
                fig_trd.update_layout(
                    paper_bgcolor="#ffffff", plot_bgcolor="#f8fafc", font_color="#1e293b",
                    height=260, margin=dict(t=40, b=50, l=40, r=20),
                    xaxis_title="", yaxis_title="Avg Variance %",
                    yaxis=dict(ticksuffix="%", gridcolor="#e2e8f0"),
                )
                st.plotly_chart(fig_trd, use_container_width=True)

            with ch3:
                _prod_opts = {f"{r['MATERIAL_NUMBER']} — {r['MATERIAL_DESCRIPTION']}": r["MATERIAL_NUMBER"]
                              for _, r in top10.iterrows()}
                sel_lbl = st.selectbox("Product for components", list(_prod_opts.keys()),
                                       key="vf_prod", label_visibility="collapsed")
                sel_mat = _prod_opts[sel_lbl]
                try:
                    comp = query(f"""
                        SELECT COST_COMPONENT,
                               ROUND(AVG(STANDARD_COST), 4) AS BUDGET,
                               ROUND(AVG(ACTUAL_COST), 4)   AS ACTUAL
                        FROM {DATABASE}.ANALYTICS.COST_COMPONENT_DETAIL
                        WHERE MATERIAL_NUMBER = '{sel_mat}' AND FISCAL_YEAR = 2026
                        GROUP BY COST_COMPONENT ORDER BY ACTUAL DESC
                    """)
                    if not comp.empty:
                        fig_c = go.Figure()
                        fig_c.add_trace(go.Bar(x=comp["BUDGET"], y=comp["COST_COMPONENT"],
                            orientation="h", name="Budget",
                            marker_color="#29b5e8", opacity=0.65))
                        fig_c.add_trace(go.Bar(x=comp["ACTUAL"], y=comp["COST_COMPONENT"],
                            orientation="h", name="Actual",
                            marker_color="#ef4444", opacity=0.75))
                        fig_c.update_layout(
                            title=dict(text="Budget Cost Components", font=dict(size=12, color="#1e293b")),
                            paper_bgcolor="#ffffff", plot_bgcolor="#f8fafc",
                            font_color="#1e293b", height=260, barmode="group",
                            margin=dict(t=40, b=50, l=110, r=20),
                            legend=dict(font=dict(size=9), orientation="h", y=-0.25),
                            xaxis=dict(tickprefix="$", gridcolor="#e2e8f0", tickfont=dict(size=9)),
                            yaxis=dict(tickfont=dict(size=9)),
                        )
                        st.plotly_chart(fig_c, use_container_width=True)
                    else:
                        st.markdown('<p style="font-size:.8rem;color:#64748b;padding:20px 0">No component data for this product</p>', unsafe_allow_html=True)
                except Exception:
                    st.markdown('<p style="font-size:.8rem;color:#64748b;padding:20px 0">Click a product to see cost breakdown</p>', unsafe_allow_html=True)

            # ── Product Cost Detail card ─────────────────────────────────────
            st.markdown('<div style="font-size:.9rem;font-weight:600;color:#1e293b;margin:12px 0 8px">'
                        'Product Cost Detail — Standard vs Actual (SAP MBEW / CKMLCR)</div>',
                        unsafe_allow_html=True)
            view_cols = st.columns([1, 5])
            with view_cols[0]:
                view_mode = st.radio("View", ["Table", "× Site", "× Period"],
                                     key="vf_view", label_visibility="collapsed")

            if view_mode == "Table":
                detail = query(f"""
                    SELECT MATERIAL_NUMBER, MATERIAL_DESCRIPTION, PLANT_NAME, PERIOD,
                           ROUND(STANDARD_COST_PER_UNIT,2) AS BUDGET,
                           ROUND(ACTUAL_COST_PER_UNIT,2)   AS ACTUAL,
                           ROUND(COST_VARIANCE_ABS,2)       AS VARIANCE_ABS,
                           ROUND(COST_VARIANCE_PCT,2)       AS VARIANCE_PCT
                    FROM {DATABASE}.ANALYTICS.PRODUCT_COST_SUMMARY
                    {_wv}
                    ORDER BY ABS(COST_VARIANCE_PCT) DESC
                """)
                detail["PERIOD"] = detail["PERIOD"].apply(_plabel)

                # Quick-filter row (mirrors the React inline column filters)
                st.markdown('<div style="margin-bottom:4px"></div>', unsafe_allow_html=True)
                qf1, qf2, qf3, qf4 = st.columns([2, 2, 2, 1])
                with qf1:
                    f_mat = st.text_input("filter…", key="qf_mat", placeholder="Material filter",
                                          label_visibility="collapsed")
                with qf2:
                    f_desc = st.text_input("filter…", key="qf_desc", placeholder="Description filter",
                                           label_visibility="collapsed")
                with qf3:
                    f_site = st.text_input("filter…", key="qf_site", placeholder="Site filter",
                                           label_visibility="collapsed")
                with qf4:
                    period_choices = ["All"] + sorted(detail["PERIOD"].unique().tolist())
                    f_per = st.selectbox("Period", period_choices, key="qf_per",
                                         label_visibility="collapsed")

                # Apply filters
                filtered = detail.copy()
                if f_mat:   filtered = filtered[filtered["MATERIAL_NUMBER"].str.contains(f_mat, case=False, na=False)]
                if f_desc:  filtered = filtered[filtered["MATERIAL_DESCRIPTION"].str.contains(f_desc, case=False, na=False)]
                if f_site:  filtered = filtered[filtered["PLANT_NAME"].str.contains(f_site, case=False, na=False)]
                if f_per != "All": filtered = filtered[filtered["PERIOD"] == f_per]

                match_label = f'<div style="font-size:.72rem;color:#64748b;margin-bottom:6px">{len(filtered):,} row{"s" if len(filtered)!=1 else ""} shown</div>'
                st.markdown(match_label, unsafe_allow_html=True)
                st.markdown(styled_table(
                    filtered,
                    fmt={"BUDGET":"${:.2f}","ACTUAL":"${:.2f}",
                         "VARIANCE_ABS":"${:+.2f}","VARIANCE_PCT":"{:+.1f}%"},
                    variance_cols=["VARIANCE_PCT","VARIANCE_ABS"],
                ), unsafe_allow_html=True)

            elif view_mode == "× Site":
                piv = query(f"""
                    SELECT MATERIAL_NUMBER,
                           PLANT_NAME,
                           ROUND(AVG(COST_VARIANCE_PCT),2) AS VARIANCE_PCT
                    FROM {DATABASE}.ANALYTICS.PRODUCT_COST_SUMMARY
                    WHERE FISCAL_YEAR=2026 AND MATERIAL_TYPE='{mat_fv}'
                    GROUP BY 1,2
                """)
                st.markdown(pivot_heatmap(piv, "MATERIAL_NUMBER", "PLANT_NAME", "VARIANCE_PCT"),
                            unsafe_allow_html=True)

            else:  # × Period
                piv = query(f"""
                    SELECT MATERIAL_NUMBER, PERIOD,
                           ROUND(AVG(COST_VARIANCE_PCT),2) AS VARIANCE_PCT
                    FROM {DATABASE}.ANALYTICS.PRODUCT_COST_SUMMARY
                    WHERE FISCAL_YEAR=2026 AND MATERIAL_TYPE='{mat_fv}'
                    GROUP BY 1,2
                """)
                piv["PERIOD_LBL"] = piv["PERIOD"].apply(_plabel)
                ordered_months = [_PMAP[i] for i in sorted(_PMAP) if _PMAP[i] in piv["PERIOD_LBL"].values]
                st.markdown(pivot_heatmap(piv, "MATERIAL_NUMBER", "PERIOD_LBL",
                                         "VARIANCE_PCT", col_order=ordered_months),
                            unsafe_allow_html=True)

    except Exception as e:
        st.error(f"Variance data failed: {e}")


# ── SCENARIO ANALYSIS ─────────────────────────────────────────────────────────
with tabs[1]:
    _SC_COLORS = {"Base": "#29b5e8", "API Cost Shock": "#f59e0b", "Volume Drop": "#8b5cf6"}
    _SC_BG     = {"Base": "rgba(41,181,232,.04)", "API Cost Shock": "rgba(245,158,11,.04)", "Volume Drop": "rgba(139,92,246,.04)"}

    def _kpi(label, value, sub, color="#1e293b"):
        return (f'<div style="background:#fff;border:1px solid #e2e8f0;border-radius:10px;'
                f'padding:16px 18px;box-shadow:0 1px 4px rgba(0,0,0,.08);display:flex;flex-direction:column">'
                f'<div style="font-size:.72rem;text-transform:uppercase;letter-spacing:.5px;color:#64748b;'
                f'font-weight:500;margin-bottom:8px">{label}</div>'
                f'<div style="font-size:1.5rem;font-weight:700;color:{color};line-height:1;margin-bottom:auto">{value}</div>'
                f'<div style="font-size:.75rem;color:#64748b;margin-top:8px">{sub}</div></div>')

    try:
        scen_df = query(f"SELECT * FROM {DATABASE}.ANALYTICS.SCENARIO_INPUTS ORDER BY SCENARIO_ID")

        # ── KPI row ─────────────────────────────────────────────────────────
        kpi_res = query("""
            SELECT IS_BASE, MATERIAL_NUMBER, ROUND(AVG(COST_DELTA_PCT),2) AS PCT
            FROM {DATABASE}.ANALYTICS.SCENARIO_RESULTS
            WHERE IS_BASE = FALSE
            GROUP BY 1,2
        """)
        max_d = float(kpi_res["PCT"].abs().max()) if not kpi_res.empty else 0
        avg_d = float(kpi_res["PCT"].mean()) if not kpi_res.empty else 0
        n_sc  = len(scen_df)

        kc1, kc2, kc3 = st.columns(3)
        kc1.markdown(_kpi("Active Scenarios", n_sc, f"Base + {n_sc-1} what-if"), unsafe_allow_html=True)
        kc2.markdown(_kpi("Max Portfolio Impact",
                          f"{'+' if max_d>0 else ''}{max_d:.1f}%", "Worst product vs base",
                          "#ef4444" if max_d > 5 else "#f59e0b"), unsafe_allow_html=True)
        kc3.markdown(_kpi("Avg Scenario Delta",
                          f"{'+' if avg_d>0 else ''}{avg_d:.1f}%", "Across all what-if scenarios",
                          "#ef4444" if avg_d > 3 else "#f59e0b" if avg_d > 1 else "#10b981"),
                     unsafe_allow_html=True)
        st.markdown('<div style="height:16px"></div>', unsafe_allow_html=True)

        # ── Scenario cards (one column per scenario) ─────────────────────────
        scen_cols = st.columns(len(scen_df))
        for col, (_, row) in zip(scen_cols, scen_df.iterrows()):
            sid     = int(row["SCENARIO_ID"])
            sname   = str(row["SCENARIO_NAME"])
            is_base = bool(row["IS_BASE"])
            color   = _SC_COLORS.get(sname, "#64748b")
            bg      = _SC_BG.get(sname, "rgba(100,116,139,.04)")

            with col:
                badge = ('<span style="font-size:.62rem;background:#d1fae5;color:#065f46;'
                         'padding:2px 7px;border-radius:10px;font-weight:700;margin-left:6px">BASE</span>'
                         if is_base else "")
                st.markdown(f"""
                <div style="border:2px solid {color};border-radius:10px;padding:14px 16px 12px;
                            background:{bg};margin-bottom:10px">
                  <div style="display:flex;align-items:center;gap:6px;margin-bottom:8px;flex-wrap:wrap">
                    <span style="width:10px;height:10px;border-radius:50%;background:{color};flex-shrink:0"></span>
                    <span style="font-weight:700;font-size:.9rem;color:#1e293b">{sname}</span>{badge}
                  </div>
                  <p style="font-size:.72rem;color:#64748b;line-height:1.5;margin:0">{row['DESCRIPTION']}</p>
                </div>""", unsafe_allow_html=True)

                api_v = st.slider("API / Drug Substance cost", -30, 50,
                                  int(row["API_COST_CHANGE_PCT"]), 5,
                                  key=f"s{sid}_api", disabled=is_base, format="%d%%")
                lab_v = st.slider("Labour rate change", -10, 30,
                                  int(row["LABOUR_COST_CHANGE_PCT"]), 5,
                                  key=f"s{sid}_lab", disabled=is_base, format="%d%%")
                vol_v = st.slider("Volume multiplier", 0.3, 2.0,
                                  float(row["VOLUME_MULTIPLIER"]), 0.1,
                                  key=f"s{sid}_vol", disabled=is_base, format="%.1fx")
                fx_v  = st.slider("FX / other cost change", -20, 20,
                                  int(row["FX_ADJUSTMENT_PCT"]), 5,
                                  key=f"s{sid}_fx", disabled=is_base, format="%d%%")

                if not is_base:
                    if st.button("▶  Run Scenario", key=f"run_{sid}",
                                 use_container_width=True):
                        try:
                            session.sql(f"""
                                UPDATE {DATABASE}.ANALYTICS.SCENARIO_INPUTS
                                SET API_COST_CHANGE_PCT    = {api_v},
                                    LABOUR_COST_CHANGE_PCT = {lab_v},
                                    VOLUME_MULTIPLIER      = {vol_v},
                                    FX_ADJUSTMENT_PCT      = {fx_v}
                                WHERE SCENARIO_ID = {sid}
                            """).collect()
                            query.clear()
                            st.success(f"{sname} saved!")
                            st.rerun()
                        except Exception as e:
                            st.error(f"Save failed: {e}")

        # ── Period filter ────────────────────────────────────────────────────
        _pf = {"All Periods": "all", "Period 1 — Jan": 1, "Period 2 — Feb": 2,
               "Period 3 — Mar": 3, "Period 4 — Apr": 4, "Period 5 — May": 5, "Period 6 — Jun": 6}
        pfc1, pfc2 = st.columns([1, 3])
        with pfc1:
            sc_per = _pf[st.selectbox("Period", list(_pf.keys()), key="sc_period")]
        with pfc2:
            st.markdown('<p style="font-size:.75rem;color:#64748b;margin-top:32px">'
                        'Showing finished goods averaged across all manufacturing sites</p>',
                        unsafe_allow_html=True)
        per_clause = "" if sc_per == "all" else f"AND PERIOD = {sc_per}"

        # ── Load results ─────────────────────────────────────────────────────
        results_df = query(f"""
            SELECT SCENARIO_ID, SCENARIO_NAME, IS_BASE,
                   MATERIAL_NUMBER, MATERIAL_DESCRIPTION,
                   ROUND(AVG(BASE_COST), 2)      AS BASE_COST,
                   ROUND(AVG(SCENARIO_COST), 2)  AS SCENARIO_COST,
                   ROUND(AVG(COST_DELTA), 2)      AS COST_DELTA,
                   ROUND(AVG(COST_DELTA_PCT), 2)  AS COST_DELTA_PCT
            FROM {DATABASE}.ANALYTICS.SCENARIO_RESULTS
            WHERE 1=1 {per_clause}
            GROUP BY 1,2,3,4,5
            ORDER BY MATERIAL_NUMBER, SCENARIO_ID
        """)

        # ── Grouped bar chart — absolute cost per unit ───────────────────────
        scen_names = results_df["SCENARIO_NAME"].unique().tolist()
        chart_rows = []
        for mat in results_df["MATERIAL_NUMBER"].unique():
            mat_df = results_df[results_df["MATERIAL_NUMBER"] == mat]
            entry = {"material": str(mat).replace("-FIN", "")}
            for _, r in mat_df.iterrows():
                entry[r["SCENARIO_NAME"]] = float(r["SCENARIO_COST"])
            chart_rows.append(entry)
        chart_df = pd.DataFrame(chart_rows)

        fig_sc = go.Figure()
        for sn in scen_names:
            if sn in chart_df.columns:
                fig_sc.add_trace(go.Bar(
                    name=sn, x=chart_df["material"], y=chart_df[sn],
                    marker_color=_SC_COLORS.get(sn, "#94a3b8"),
                    opacity=0.88, marker_line_width=0,
                ))
        fig_sc.update_layout(
            title=dict(text="Cost per Unit by Scenario — Portfolio Comparison",
                       font=dict(size=13, color="#1e293b")),
            annotations=[dict(text="Adjust sliders above and click Run Scenario to update",
                              showarrow=False, xref="paper", yref="paper",
                              x=1, y=1.1, xanchor="right",
                              font=dict(size=10, color="#64748b"))],
            paper_bgcolor="#ffffff", plot_bgcolor="#f8fafc", font_color="#1e293b",
            height=340, barmode="group",
            margin=dict(t=55, b=80, l=60, r=20),
            xaxis=dict(tickangle=-30, tickfont=dict(size=10)),
            yaxis=dict(tickprefix="$", gridcolor="#e2e8f0", title="Cost / unit"),
            legend=dict(font=dict(size=11), orientation="h", y=-0.28),
        )
        st.plotly_chart(fig_sc, use_container_width=True)

        # ── Impact table — Base cost + Scenario costs + Δ% ───────────────────
        st.markdown('<div style="font-size:.9rem;font-weight:600;color:#1e293b;margin:4px 0 8px">'
                    'Scenario Impact Summary — Cost Delta vs Base</div>', unsafe_allow_html=True)
        non_base_names = [s for s in scen_names if s != "Base"]
        base_rows = results_df[results_df["IS_BASE"].astype(bool) == True]
        impact_rows = []
        for _, br in base_rows.iterrows():
            mat = br["MATERIAL_NUMBER"]
            rd = {"Material":    str(mat).replace("-FIN",""),
                  "Description": br["MATERIAL_DESCRIPTION"],
                  "Base Cost":   f"${br['BASE_COST']:.2f}"}
            for sn in non_base_names:
                sc = results_df[(results_df["MATERIAL_NUMBER"] == mat) &
                                (results_df["SCENARIO_NAME"] == sn)]
                if not sc.empty:
                    rd[f"{sn}"]   = f"${sc.iloc[0]['SCENARIO_COST']:.2f}"
                    pct = float(sc.iloc[0]["COST_DELTA_PCT"])
                    rd[f"Δ {sn}"] = f"{'+' if pct>0 else ''}{pct:.1f}%"
                else:
                    rd[f"{sn}"] = "—"; rd[f"Δ {sn}"] = "—"
            impact_rows.append(rd)
        impact_df = pd.DataFrame(impact_rows)
        delta_cols = [c for c in impact_df.columns if c.startswith("Δ ")]
        st.markdown(styled_table(impact_df, variance_cols=delta_cols), unsafe_allow_html=True)

    except Exception as e:
        st.error(f"Scenario analysis failed: {e}")


# ── PROFITABILITY ─────────────────────────────────────────────────────────────
with tabs[2]:
    _MKT_COLORS = {"United States": "#29b5e8", "Europe": "#8b5cf6",
                   "Japan": "#f59e0b", "Emerging Mkts": "#10b981"}

    st.markdown('<p style="font-size:.82rem;color:#64748b;margin-bottom:12px">'
                'Combines <strong>CO-PC cost data</strong> (SAP MBEW/CKMLCR via SAP BDC Connect) with '
                '<strong>SD billing revenue</strong> (SAP VBRP/VBRK) to produce a '
                '<strong>CO-PA style gross margin view</strong> — the full product P&amp;L in one place.</p>',
                unsafe_allow_html=True)

    # Period filter
    _pf_prof = {"All Periods (YTD)": "all", "Period 1 — Jan": 1,
                "Period 2 — Feb": 2, "Period 3 — Mar": 3}
    pf_col, _ = st.columns([1, 3])
    with pf_col:
        _pf_sel = st.selectbox("Period", list(_pf_prof.keys()), key="prof_period")
    _prof_per = _pf_prof[_pf_sel]
    _pc = "" if _prof_per == "all" else f"AND PERIOD = {_prof_per}"

    try:
        # ── By-product query ─────────────────────────────────────────────────
        # PRODUCT_PROFITABILITY has SUM() expressions internally (dynamic table).
        # SQL SUM() on top of those columns always triggers nested-aggregate errors.
        # Fix: read raw rows (material × market × period grain), aggregate in pandas.
        raw_df = query(f"""
            SELECT MATERIAL_NUMBER, MATERIAL_DESCRIPTION, MARKET, PERIOD,
                   REVENUE, COGS_ACTUAL, COGS_BUDGET,
                   GROSS_PROFIT_ACTUAL, GROSS_PROFIT_BUDGET
            FROM {DATABASE}.ANALYTICS.PRODUCT_PROFITABILITY
            WHERE FISCAL_YEAR = 2026 {_pc}
        """)

        # ── By-product aggregation ────────────────────────────────────────────
        _g = raw_df.groupby(["MATERIAL_NUMBER","MATERIAL_DESCRIPTION"])
        prod_df = _g.agg(
            REVENUE          =("REVENUE",            "sum"),
            COGS_ACTUAL      =("COGS_ACTUAL",         "sum"),
            COGS_BUDGET      =("COGS_BUDGET",         "sum"),
            GROSS_PROFIT     =("GROSS_PROFIT_ACTUAL", "sum"),
            GROSS_PROFIT_BUDGET=("GROSS_PROFIT_BUDGET","sum"),
        ).reset_index()
        prod_df["MARGIN_ACT"]   = (prod_df["GROSS_PROFIT"]         / prod_df["REVENUE"].replace(0, float("nan")) * 100).round(1)
        prod_df["MARGIN_BUD"]   = (prod_df["GROSS_PROFIT_BUDGET"]  / prod_df["REVENUE"].replace(0, float("nan")) * 100).round(1)
        prod_df["MARGIN_DELTA"] = (prod_df["MARGIN_ACT"] - prod_df["MARGIN_BUD"]).round(1)
        prod_df = prod_df.sort_values("REVENUE", ascending=False).reset_index(drop=True)

        # ── By-market aggregation ─────────────────────────────────────────────
        mkt_df = raw_df.groupby(["MARKET","MATERIAL_NUMBER","MATERIAL_DESCRIPTION"]).agg(
            REVENUE      =("REVENUE",            "sum"),
            GROSS_PROFIT =("GROSS_PROFIT_ACTUAL", "sum"),
        ).reset_index().sort_values(["MARKET","REVENUE"], ascending=[True,False])

        # ── YTD trend ─────────────────────────────────────────────────────────
        ytd_df = raw_df.groupby("PERIOD").agg(
            REVENUE_M=("REVENUE",            lambda x: round(x.sum()/1e6, 2)),
            GP_M     =("GROSS_PROFIT_ACTUAL", lambda x: round(x.sum()/1e6, 2)),
        ).reset_index().sort_values("PERIOD")
        _PLAB = {1:"P001 Jan",2:"P002 Feb",3:"P003 Mar",4:"P004 Apr",5:"P005 May",6:"P006 Jun"}
        ytd_df["PL"] = ytd_df["PERIOD"].apply(lambda p: _PLAB.get(int(p), str(p)))

        # ── KPI cards ────────────────────────────────────────────────────────
        tot_rev  = float(prod_df["REVENUE"].sum())
        tot_gp   = float(prod_df["GROSS_PROFIT"].sum())
        avg_mact = float(prod_df["MARGIN_ACT"].mean()) if not prod_df.empty else 0
        avg_mbud = float(prod_df["MARGIN_BUD"].mean()) if not prod_df.empty else 0
        delta_pp = avg_mact - avg_mbud

        def _kpi_p(label, value, sub, color="#1e293b"):
            return (f'<div style="background:#fff;border:1px solid #e2e8f0;border-radius:10px;'
                    f'padding:16px 18px;box-shadow:0 1px 4px rgba(0,0,0,.08)">'
                    f'<div style="font-size:.72rem;text-transform:uppercase;letter-spacing:.5px;'
                    f'color:#64748b;font-weight:500;margin-bottom:8px">{label}</div>'
                    f'<div style="font-size:1.5rem;font-weight:700;color:{color};line-height:1">{value}</div>'
                    f'<div style="font-size:.75rem;color:#64748b;margin-top:6px">{sub}</div></div>')

        pk1, pk2, pk3, pk4 = st.columns(4)
        pk1.markdown(_kpi_p("Total Revenue (YTD)", f"${tot_rev/1e6:.1f}M", "All markets, all products"), unsafe_allow_html=True)
        pk2.markdown(_kpi_p("Gross Profit", f"${tot_gp/1e6:.1f}M", "Revenue minus actual COGS", "#10b981"), unsafe_allow_html=True)
        pk3.markdown(_kpi_p("Avg Gross Margin", f"{avg_mact:.1f}%",
                             f"vs {avg_mbud:.1f}% budget",
                             "#10b981" if avg_mact > 60 else "#f59e0b" if avg_mact > 40 else "#ef4444"),
                     unsafe_allow_html=True)
        pk4.markdown(_kpi_p("Margin vs Budget",
                             f"{'+' if delta_pp>=0 else ''}{delta_pp:.1f} pp",
                             "Actual vs standard cost impact",
                             "#10b981" if delta_pp >= 0 else "#ef4444"),
                     unsafe_allow_html=True)
        st.markdown('<div style="height:12px"></div>', unsafe_allow_html=True)

        # ── Revenue & Gross Profit trend (full width) ─────────────────────────
        fig_trend = go.Figure()
        fig_trend.add_trace(go.Scatter(
            x=ytd_df["PL"], y=ytd_df["REVENUE_M"], name="Revenue",
            mode="lines+markers", fill="tozeroy",
            fillcolor="rgba(41,181,232,0.12)", line=dict(color="#29b5e8", width=2),
            marker=dict(size=5)))
        fig_trend.add_trace(go.Scatter(
            x=ytd_df["PL"], y=ytd_df["GP_M"], name="Gross Profit",
            mode="lines+markers", line=dict(color="#10b981", width=2), marker=dict(size=5)))
        fig_trend.update_layout(
            title=dict(text="Revenue & Gross Profit Trend — YTD", font=dict(size=13, color="#1e293b")),
            annotations=[dict(text="$M — all products, all markets", showarrow=False,
                              xref="paper", yref="paper", x=1, y=1.1, xanchor="right",
                              font=dict(size=10, color="#64748b"))],
            paper_bgcolor="#ffffff", plot_bgcolor="#f8fafc", font_color="#1e293b",
            height=240, margin=dict(t=55, b=30, l=50, r=20),
            yaxis=dict(tickprefix="$", ticksuffix="M", gridcolor="#e2e8f0"),
            legend=dict(font=dict(size=11), orientation="h", y=-0.15),
        )
        st.plotly_chart(fig_trend, use_container_width=True)

        # ── Two-column: Margin by product + Revenue by market ────────────────
        gc1, gc2 = st.columns(2)

        with gc1:
            st.markdown('<div style="font-size:.9rem;font-weight:600;color:#1e293b;margin-bottom:4px">'
                        'Gross Margin % by Product'
                        '<span style="font-size:.72rem;color:#64748b;font-weight:400;margin-left:10px">'
                        'Actual vs Budget</span></div>', unsafe_allow_html=True)
            mat_labels = prod_df["MATERIAL_NUMBER"].str.replace("-FIN", "", regex=False)
            fig_margin = go.Figure()
            fig_margin.add_trace(go.Bar(y=mat_labels, x=prod_df["MARGIN_BUD"],
                orientation="h", name="Budget %", marker_color="#e2e8f0", opacity=0.9, marker_line_width=0))
            fig_margin.add_trace(go.Bar(y=mat_labels, x=prod_df["MARGIN_ACT"],
                orientation="h", name="Actual %", marker_color="#29b5e8", opacity=0.88, marker_line_width=0))
            fig_margin.update_layout(
                paper_bgcolor="#ffffff", plot_bgcolor="#f8fafc", font_color="#1e293b",
                height=300, barmode="overlay", margin=dict(t=10, b=30, l=10, r=20),
                xaxis=dict(ticksuffix="%", range=[0,100], gridcolor="#e2e8f0", tickfont=dict(size=9)),
                yaxis=dict(tickfont=dict(size=10)),
                legend=dict(font=dict(size=10), orientation="h", y=-0.12),
            )
            st.plotly_chart(fig_margin, use_container_width=True)

        with gc2:
            st.markdown('<div style="font-size:.9rem;font-weight:600;color:#1e293b;margin-bottom:4px">'
                        'Revenue by Market ($M)'
                        '<span style="font-size:.72rem;color:#64748b;font-weight:400;margin-left:10px">'
                        'Stacked by region</span></div>', unsafe_allow_html=True)
            markets = mkt_df["MARKET"].unique().tolist()
            mkt_wide = {}
            for _, r in mkt_df.iterrows():
                prod = str(r["MATERIAL_NUMBER"]).replace("-FIN","")
                mkt_wide.setdefault(prod, {"product": prod})
                mkt_wide[prod][r["MARKET"]] = float(r["REVENUE"]) / 1e6
            mkt_chart = pd.DataFrame(list(mkt_wide.values()))
            fig_mkt = go.Figure()
            for m in markets:
                if m in mkt_chart.columns:
                    fig_mkt.add_trace(go.Bar(
                        name=m, x=mkt_chart["product"], y=mkt_chart[m],
                        marker_color=_MKT_COLORS.get(m, "#94a3b8"),
                        opacity=0.88, marker_line_width=0))
            fig_mkt.update_layout(
                paper_bgcolor="#ffffff", plot_bgcolor="#f8fafc", font_color="#1e293b",
                height=300, barmode="stack", margin=dict(t=10, b=60, l=20, r=20),
                xaxis=dict(tickangle=-30, tickfont=dict(size=9)),
                yaxis=dict(tickprefix="$", ticksuffix="M", gridcolor="#e2e8f0"),
                legend=dict(font=dict(size=10), orientation="h", y=-0.3),
            )
            st.plotly_chart(fig_mkt, use_container_width=True)

        # ── Product P&L table ────────────────────────────────────────────────
        st.markdown('<div style="font-size:.9rem;font-weight:600;color:#1e293b;margin:8px 0">'
                    'Product P&amp;L Summary — Actual vs Budget (CO-PA view)</div>',
                    unsafe_allow_html=True)
        tbl = prod_df.copy()
        tbl["Material"]      = tbl["MATERIAL_NUMBER"].str.replace("-FIN","", regex=False)
        tbl["Description"]   = tbl["MATERIAL_DESCRIPTION"]
        tbl["Revenue"]       = tbl["REVENUE"].apply(lambda v: f"${v/1e6:.1f}M")
        tbl["COGS Budget"]   = tbl["COGS_BUDGET"].apply(lambda v: f"${v/1e6:.1f}M")
        tbl["COGS Actual"]   = tbl["COGS_ACTUAL"].apply(lambda v: f"${v/1e6:.1f}M")
        tbl["Gross Profit"]  = tbl["GROSS_PROFIT"].apply(lambda v: f"${v/1e6:.1f}M")
        tbl["Margin (Act)"]  = tbl["MARGIN_ACT"].apply(lambda v: f"{v:.1f}%")
        tbl["Margin (Bud)"]  = tbl["MARGIN_BUD"].apply(lambda v: f"{v:.1f}%")
        tbl["Δ vs Budget"]   = tbl["MARGIN_DELTA"].apply(lambda v: f"{'+' if v>=0 else ''}{v:.1f} pp")
        st.markdown(styled_table(
            tbl[["Material","Description","Revenue","COGS Budget","COGS Actual",
                 "Gross Profit","Margin (Act)","Margin (Bud)","Δ vs Budget"]],
            variance_cols=["Δ vs Budget"],
        ), unsafe_allow_html=True)

    except Exception as e:
        st.error(f"Profitability data failed: {e}")


# ── SALES FORECAST ────────────────────────────────────────────────────────────
with tabs[3]:
    RISK_COMPRESSION_COLOR = {"HIGH": "#ef4444", "MEDIUM": "#f59e0b", "LOW": "#10b981"}
    RISK_COMPRESSION_BG    = {"HIGH": "#fef2f2", "MEDIUM": "#fffbeb", "LOW": "#f0fdf4"}

    def _kpi_sf(label, value, sub, color="#1e293b"):
        return (f'<div style="background:#fff;border:1px solid #e2e8f0;border-radius:10px;'
                f'padding:16px 18px;box-shadow:0 1px 4px rgba(0,0,0,.08)">'
                f'<div style="font-size:.72rem;text-transform:uppercase;letter-spacing:.5px;'
                f'color:#64748b;font-weight:500;margin-bottom:8px">{label}</div>'
                f'<div style="font-size:1.5rem;font-weight:700;color:{color};line-height:1">{value}</div>'
                f'<div style="font-size:.75rem;color:#64748b;margin-top:6px">{sub}</div></div>')

    st.markdown('<p style="font-size:.82rem;color:#64748b;margin-bottom:12px">'
                'Uses <strong>Snowflake ML.FORECAST</strong> trained on SD billing history (FY2026 H1) to forecast '
                'H2 revenue and volume, then bridges against the cost forecast to show '
                '<strong>gross margin compression</strong> driven by rising manufacturing costs.</p>',
                unsafe_allow_html=True)

    # Product selector
    _sf_products = [
        "RX-1234-FIN", "RX-2891-FIN", "RX-3312-FIN", "RX-4567-FIN", "RX-5521-FIN",
        "RX-6103-FIN", "RX-7890-FIN", "RX-8834-FIN", "RX-9901-FIN", "RX-1156-FIN",
    ]
    _sf_col, _ = st.columns([1, 3])
    with _sf_col:
        _sf_prod = st.selectbox("Product", _sf_products, key="sf_product")

    try:
        # ── Revenue + margin trend ────────────────────────────────────────────
        sf_trend = query("""
            SELECT TS, MATERIAL_NUMBER, DATA_TYPE,
                   ACTUAL_REVENUE, ACTUAL_VOLUME, ACTUAL_MARGIN_PCT,
                   FORECAST_REVENUE, REVENUE_LOWER, REVENUE_UPPER,
                   FORECAST_VOLUME, FORECAST_MARGIN_PCT
            FROM {DATABASE}.ANALYTICS.MARGIN_FORECAST_BRIDGE
            ORDER BY MATERIAL_NUMBER, TS
        """)

        # ── Margin compression summary ────────────────────────────────────────
        sf_comp = query("""
            SELECT MATERIAL_NUMBER, MATERIAL_DESCRIPTION,
                   H1_MARGIN_PCT, H2_MARGIN_PCT, MARGIN_CHANGE_PTS,
                   H1_REVENUE, H2_REVENUE, REVENUE_AT_RISK, COMPRESSION_RISK
            FROM {DATABASE}.ANALYTICS.MARGIN_COMPRESSION_SUMMARY
            ORDER BY MARGIN_CHANGE_PTS ASC
        """)

        # ── KPI aggregates ────────────────────────────────────────────────────
        # Cast to numeric — Snowflake may return some columns as object/string
        for col in ["FORECAST_REVENUE","ACTUAL_REVENUE","ACTUAL_MARGIN_PCT","FORECAST_MARGIN_PCT",
                    "REVENUE_LOWER","REVENUE_UPPER","FORECAST_VOLUME","ACTUAL_VOLUME"]:
            if col in sf_trend.columns:
                sf_trend[col] = pd.to_numeric(sf_trend[col], errors="coerce")
        for col in ["H1_MARGIN_PCT","H2_MARGIN_PCT","MARGIN_CHANGE_PTS","H1_REVENUE","H2_REVENUE","REVENUE_AT_RISK"]:
            if col in sf_comp.columns:
                sf_comp[col] = pd.to_numeric(sf_comp[col], errors="coerce")

        h2_rev  = sf_trend[sf_trend["DATA_TYPE"] == "forecast"]["FORECAST_REVENUE"].sum()
        h1_mar  = sf_trend[sf_trend["DATA_TYPE"] == "actual"]["ACTUAL_MARGIN_PCT"].mean()
        h2_mar  = sf_trend[sf_trend["DATA_TYPE"] == "forecast"]["FORECAST_MARGIN_PCT"].mean()
        mar_chg = float(h2_mar or 0) - float(h1_mar or 0)
        high_risk = int((sf_comp["COMPRESSION_RISK"] == "HIGH").sum()) if not sf_comp.empty else 0

        sk1, sk2, sk3, sk4 = st.columns(4)
        sk1.markdown(_kpi_sf("H2 Forecast Revenue", f"${h2_rev/1e6:.1f}M", "Apr–Dec 2026 ML forecast"), unsafe_allow_html=True)
        sk2.markdown(_kpi_sf("H1 Avg Gross Margin", f"{h1_mar:.1f}%", "Jan–Mar 2026 actuals", "#10b981"), unsafe_allow_html=True)
        sk3.markdown(_kpi_sf("H2 Forecast Margin", f"{h2_mar:.1f}%",
                              f"{'+' if mar_chg >= 0 else ''}{mar_chg:.1f} pp vs H1",
                              "#10b981" if mar_chg >= 0 else "#ef4444"), unsafe_allow_html=True)
        sk4.markdown(_kpi_sf("High Margin Risk Products", str(high_risk),
                              "Products with >3pp compression",
                              "#ef4444" if high_risk > 0 else "#10b981"), unsafe_allow_html=True)
        st.markdown('<div style="height:12px"></div>', unsafe_allow_html=True)

        # ── Revenue forecast chart ────────────────────────────────────────────
        _sf_p = sf_trend[sf_trend["MATERIAL_NUMBER"] == _sf_prod].copy()
        _sf_p["TS"] = pd.to_datetime(_sf_p["TS"]).dt.strftime("%Y-%m")
        # Re-cast after copy to guarantee float dtype regardless of Snowflake return type
        for _c in ["ACTUAL_REVENUE","ACTUAL_VOLUME","ACTUAL_MARGIN_PCT","ACTUAL_GROSS_MARGIN",
                   "FORECAST_REVENUE","REVENUE_LOWER","REVENUE_UPPER",
                   "FORECAST_VOLUME","FORECAST_MARGIN_PCT","COST_PER_UNIT"]:
            if _c in _sf_p.columns:
                _sf_p[_c] = pd.to_numeric(_sf_p[_c], errors="coerce")

        fig_rev = go.Figure()
        _act = _sf_p[_sf_p["DATA_TYPE"] == "actual"].sort_values("TS").reset_index(drop=True)
        _fct = _sf_p[_sf_p["DATA_TYPE"] == "forecast"].sort_values("TS").reset_index(drop=True)

        # Bridge: build explicit float arrays for forecast lines so the lines connect at transition
        if not _act.empty and not _fct.empty:
            _bridge_ts  = [_act["TS"].iloc[-1]]
            _bridge_rev = [float(_act["ACTUAL_REVENUE"].iloc[-1])]
            _bridge_mar = [float(_act["ACTUAL_MARGIN_PCT"].iloc[-1])]
            _fct_ts  = _bridge_ts  + list(_fct["TS"])
            _fct_rev = _bridge_rev + [float(v) for v in _fct["FORECAST_REVENUE"]]
            _fct_lo  = _bridge_rev + [float(v) if pd.notna(v) else float(_bridge_rev[0]) for v in _fct["REVENUE_LOWER"]]
            _fct_hi  = _bridge_rev + [float(v) if pd.notna(v) else float(_bridge_rev[0]) for v in _fct["REVENUE_UPPER"]]
            _fct_mar = _bridge_mar + [float(v) if pd.notna(v) else None for v in _fct["FORECAST_MARGIN_PCT"]]
        else:
            _fct_ts  = list(_fct["TS"])
            _fct_rev = [float(v) for v in _fct["FORECAST_REVENUE"]]
            _fct_lo  = [float(v) if pd.notna(v) else None for v in _fct["REVENUE_LOWER"]]
            _fct_hi  = [float(v) if pd.notna(v) else None for v in _fct["REVENUE_UPPER"]]
            _fct_mar = [float(v) if pd.notna(v) else None for v in _fct["FORECAST_MARGIN_PCT"]]

        # Confidence band
        fig_rev.add_trace(go.Scatter(
            x=_fct_ts + _fct_ts[::-1],
            y=[v / 1e6 for v in _fct_hi] + [v / 1e6 for v in _fct_lo[::-1]],
            fill="toself", fillcolor="rgba(191,219,254,0.4)",
            line=dict(color="rgba(0,0,0,0)"), name="Confidence band", showlegend=True,
        ))
        fig_rev.add_trace(go.Scatter(
            x=list(_act["TS"]), y=[float(v) / 1e6 for v in _act["ACTUAL_REVENUE"]],
            mode="lines+markers", line=dict(color="#29b5e8", width=2.5),
            marker=dict(size=6), name="Actual revenue",
        ))
        fig_rev.add_trace(go.Scatter(
            x=_fct_ts, y=[v / 1e6 for v in _fct_rev],
            mode="lines", line=dict(color="#f59e0b", width=2, dash="dash"),
            name="Forecast revenue",
        ))
        fig_rev.add_vline(x="2026-04", line_dash="dash", line_color="#ef4444",
                          annotation_text="API Shock", annotation_font_size=10,
                          annotation_font_color="#ef4444")
        fig_rev.update_layout(
            title=f"Revenue Forecast — {_sf_prod}",
            xaxis_title=None, yaxis_title="Revenue ($M)",
            plot_bgcolor="#fafafa", paper_bgcolor="#fff",
            font=dict(size=11), legend=dict(orientation="h", y=-0.2),
            margin=dict(l=10, r=10, t=40, b=10), height=280,
        )
        st.plotly_chart(fig_rev, use_container_width=True, key="sf_rev_chart")

        # ── Margin compression chart ──────────────────────────────────────────
        fig_mar = go.Figure()
        fig_mar.add_trace(go.Scatter(
            x=list(_act["TS"]), y=[float(v) for v in _act["ACTUAL_MARGIN_PCT"]],
            mode="lines+markers", line=dict(color="#29b5e8", width=2.5),
            marker=dict(size=6), name="Actual margin %",
        ))
        fig_mar.add_trace(go.Scatter(
            x=_fct_ts, y=_fct_mar,
            mode="lines", line=dict(color="#ef4444", width=2, dash="dash"),
            name="Forecast margin %",
        ))
        fig_mar.add_vline(x="2026-04", line_dash="dash", line_color="#ef4444")
        fig_mar.update_layout(
            title="Gross Margin % — Actual vs Forecast (Cost-Driven Compression)",
            xaxis_title=None, yaxis_title="Gross Margin %",
            plot_bgcolor="#fafafa", paper_bgcolor="#fff",
            font=dict(size=11), legend=dict(orientation="h", y=-0.2),
            margin=dict(l=10, r=10, t=40, b=10), height=260,
        )
        st.markdown('<p style="font-size:.72rem;color:#64748b;margin:4px 0 8px 0">'
                    'Rising cost variance (API shock, energy price) escalates the forward cost per unit, '
                    'compressing H2 forecast gross margin. The gap between actual (blue) and forecast (red) '
                    'is margin at risk from cost inflation.</p>', unsafe_allow_html=True)
        st.plotly_chart(fig_mar, use_container_width=True, key="sf_mar_chart")

        # ── Product impact table ──────────────────────────────────────────────
        st.markdown("#### Product Margin Impact — H1 Actuals vs H2 Forecast")
        if sf_comp.empty:
            st.info("No compression data available.")
        else:
            _tbl_rows = []
            for _, r in sf_comp.iterrows():
                chg = float(r["MARGIN_CHANGE_PTS"] or 0)
                risk = str(r.get("COMPRESSION_RISK", "LOW"))
                risk_badge = (f'<span style="font-size:.72rem;font-weight:700;padding:2px 8px;'
                              f'border-radius:999px;color:{RISK_COMPRESSION_COLOR.get(risk,"#64748b")};'
                              f'background:{RISK_COMPRESSION_BG.get(risk,"#f1f5f9")}">{risk}</span>')
                chg_color = "#ef4444" if chg < 0 else "#10b981"
                _tbl_rows.append(
                    f"<tr>"
                    f"<td style='font-weight:600;padding:8px 10px'>{r['MATERIAL_NUMBER']}</td>"
                    f"<td style='text-align:right;padding:8px 10px'>{float(r['H1_MARGIN_PCT'] or 0):.1f}%</td>"
                    f"<td style='text-align:right;padding:8px 10px;color:{'#ef4444' if float(r['H2_MARGIN_PCT'] or 0) < float(r['H1_MARGIN_PCT'] or 0) else '#10b981'}'>"
                    f"{float(r['H2_MARGIN_PCT'] or 0):.1f}%</td>"
                    f"<td style='text-align:right;padding:8px 10px;color:{chg_color};font-weight:600'>"
                    f"{'+' if chg >= 0 else ''}{chg:.1f} pp</td>"
                    f"<td style='text-align:right;padding:8px 10px'>${float(r['H2_REVENUE'] or 0)/1e6:.1f}M</td>"
                    f"<td style='text-align:right;padding:8px 10px;color:#ef4444'>${float(r['REVENUE_AT_RISK'] or 0)/1e6:.1f}M</td>"
                    f"<td style='padding:8px 10px'>{risk_badge}</td>"
                    f"</tr>"
                )
            _tbl_html = (
                "<table style='width:100%;border-collapse:collapse;font-size:.82rem'>"
                "<thead><tr style='border-bottom:2px solid #e2e8f0'>"
                "<th style='text-align:left;padding:8px 10px'>Product</th>"
                "<th style='text-align:right;padding:8px 10px'>H1 Margin %</th>"
                "<th style='text-align:right;padding:8px 10px'>H2 Forecast %</th>"
                "<th style='text-align:right;padding:8px 10px'>Change</th>"
                "<th style='text-align:right;padding:8px 10px'>H2 Revenue</th>"
                "<th style='text-align:right;padding:8px 10px'>Revenue at Risk</th>"
                "<th style='padding:8px 10px'>Risk</th>"
                "</tr></thead><tbody>"
                + "".join(_tbl_rows) +
                "</tbody></table>"
            )
            st.markdown(_tbl_html, unsafe_allow_html=True)
            st.markdown('<p style="font-size:.72rem;color:#64748b;margin-top:8px">'
                        'Revenue at Risk = H2 forecast revenue × margin compression (pp). '
                        'HIGH = &gt;3pp compression, MEDIUM = 1–3pp.</p>', unsafe_allow_html=True)

    except Exception as e:
        st.error(f"Sales forecast data failed: {e}")


# ── SMART INSIGHTS ────────────────────────────────────────────────────────────
with tabs[4]:
    _RISK_COLOR = {"HIGH": "#ef4444", "MEDIUM": "#f59e0b", "LOW": "#10b981"}
    _RISK_BG    = {"HIGH": "#fef2f2", "MEDIUM": "#fffbeb", "LOW": "#f0fdf4"}

    def _kpi_si(label, value, sub, color="#1e293b"):
        return (_kpi(label, value, sub, color)
                if "_kpi" in dir() else
                f'<div style="background:#fff;border:1px solid #e2e8f0;border-radius:10px;'
                f'padding:16px 18px;box-shadow:0 1px 4px rgba(0,0,0,.08)">'
                f'<div style="font-size:.72rem;text-transform:uppercase;letter-spacing:.5px;color:#64748b;font-weight:500;margin-bottom:8px">{label}</div>'
                f'<div style="font-size:1.5rem;font-weight:700;color:{color};line-height:1">{value}</div>'
                f'<div style="font-size:.75rem;color:#64748b;margin-top:6px">{sub}</div></div>')

    st.markdown('<p style="font-size:.82rem;color:#64748b;margin-bottom:12px">'
                'Powered by <strong>Snowflake ML (FORECAST)</strong> trained on FY24–FY26 monthly SAP actuals. '
                'Anomaly detection uses z-score statistical analysis across all cost components. '
                'Recommendations generated by <strong>Snowflake Cortex AI</strong>.</p>',
                unsafe_allow_html=True)

    # ── Load all data ────────────────────────────────────────────────────────
    try:
        trend_df = query("""
            SELECT PERIOD_LABEL, ACTUAL_VARIANCE, FORECAST_VARIANCE,
                   FORECAST_LOWER, FORECAST_UPPER, DATA_TYPE
            FROM {DATABASE}.ANALYTICS.VARIANCE_TREND_WITH_FORECAST
            ORDER BY TS
        """)
    except Exception as e:
        trend_df = None
        st.error(f"Forecast data failed: {e}")

    try:
        risk_df = query("""
            SELECT MATERIAL_NUMBER, MATERIAL_DESCRIPTION,
                   VAR_P001, VAR_P003, VAR_P006, SLOPE, ESTIMATED_P007, RISK_LEVEL
            FROM {DATABASE}.ANALYTICS.PRODUCT_RISK_SCORES
            ORDER BY ABS(SLOPE) DESC
        """)
    except Exception as e:
        risk_df = None

    try:
        anom_df = query("""
            SELECT MATERIAL_NUMBER, MATERIAL_DESCRIPTION, PLANT_NAME,
                   COST_COMPONENT, PERIOD, VARIANCE_PCT, Z_SCORE
            FROM {DATABASE}.ANALYTICS.COST_ANOMALIES
            WHERE IS_ANOMALY = TRUE
            ORDER BY ABS(Z_SCORE) DESC
            LIMIT 20
        """)
    except Exception as e:
        anom_df = None
        st.error(f"Anomaly data failed: {e}")

    # ── KPI row ──────────────────────────────────────────────────────────────
    if trend_df is not None and risk_df is not None and anom_df is not None:
        fc_rows    = trend_df[trend_df["DATA_TYPE"] == "forecast"]
        p004_fc    = float(fc_rows.iloc[0]["FORECAST_VARIANCE"]) if not fc_rows.empty else 0.0
        p004_upper = float(fc_rows.iloc[0]["FORECAST_UPPER"])    if not fc_rows.empty else 0.0
        high_risk  = int((risk_df["RISK_LEVEL"] == "HIGH").sum())
        med_risk   = int((risk_df["RISK_LEVEL"] == "MEDIUM").sum())
        n_anom     = len(anom_df)

        kpi1, kpi2, kpi3, kpi4 = st.columns(4)
        kpi1.markdown(_kpi_si("ML Forecast — P004",
                              f"+{p004_fc:.1f}%",
                              f"Portfolio avg variance (upper: +{p004_upper:.1f}%)",
                              "#ef4444" if p004_fc > 5 else "#f59e0b" if p004_fc > 3 else "#10b981"),
                      unsafe_allow_html=True)
        kpi2.markdown(_kpi_si("High Risk Products", high_risk,
                              "Predicted to exceed 5% in P004",
                              "#ef4444" if high_risk > 3 else "#f59e0b"),
                      unsafe_allow_html=True)
        kpi3.markdown(_kpi_si("Medium Risk Products", med_risk,
                              "Variance trending upward", "#f59e0b"),
                      unsafe_allow_html=True)
        kpi4.markdown(_kpi_si("Anomalies Flagged", n_anom,
                              "Cost components z-score > 1.5",
                              "#ef4444" if n_anom > 5 else "#f59e0b"),
                      unsafe_allow_html=True)
        st.markdown('<div style="height:12px"></div>', unsafe_allow_html=True)

        # ── Forecast chart (full width) ──────────────────────────────────────
        actuals   = trend_df[trend_df["DATA_TYPE"] == "actual"]
        forecasts = trend_df[trend_df["DATA_TYPE"] == "forecast"]

        # Build a unified 6-point series matching the React approach:
        # last actual period carries the forecast bridge value — no duplicate categories
        act_map  = dict(zip(actuals["PERIOD_LABEL"],   actuals["ACTUAL_VARIANCE"].astype(float)))
        fc_map   = dict(zip(forecasts["PERIOD_LABEL"], forecasts["FORECAST_VARIANCE"].astype(float)))
        lo_map   = dict(zip(forecasts["PERIOD_LABEL"], forecasts["FORECAST_LOWER"].astype(float)))
        hi_map   = dict(zip(forecasts["PERIOD_LABEL"], forecasts["FORECAST_UPPER"].astype(float)))

        # Bridge: inject last actual value as the forecast start point
        if not actuals.empty:
            last_p  = actuals["PERIOD_LABEL"].iloc[-1]
            last_v  = float(actuals["ACTUAL_VARIANCE"].iloc[-1])
            fc_map[last_p] = last_v
            lo_map[last_p] = last_v
            hi_map[last_p] = last_v

        # Deduplicated, TS-ordered period list
        _period_order = list(dict.fromkeys(trend_df["PERIOD_LABEL"]))

        act_y  = [act_map.get(p) for p in _period_order]
        fc_y   = [fc_map.get(p)  for p in _period_order]
        lo_y   = [lo_map.get(p)  for p in _period_order]
        hi_y   = [hi_map.get(p)  for p in _period_order]

        fig_fc = go.Figure()
        # Confidence band
        fig_fc.add_trace(go.Scatter(
            x=_period_order, y=hi_y,
            mode="lines", line=dict(width=0), showlegend=False, name="Upper"))
        fig_fc.add_trace(go.Scatter(
            x=_period_order, y=lo_y,
            mode="lines", line=dict(width=0), fill="tonexty",
            fillcolor="rgba(41,181,232,0.12)", name="95% confidence band"))
        # Actual line
        fig_fc.add_trace(go.Scatter(
            x=_period_order, y=act_y, mode="lines+markers", name="Actual variance",
            line=dict(color="#29b5e8", width=2.5), marker=dict(size=6),
            connectgaps=False))
        # Forecast line — null for pure-actual periods (except bridge)
        fig_fc.add_trace(go.Scatter(
            x=_period_order, y=fc_y, mode="lines+markers", name="ML forecast",
            line=dict(color="#f59e0b", width=2.5, dash="dot"), marker=dict(size=6),
            connectgaps=False))

        fig_fc.update_layout(
            title=dict(text="Cost Variance Forecast — P001 to P006",
                       font=dict(size=13, color="#1e293b")),
            annotations=[dict(
                text="Trained on FY24–FY26 monthly actuals · Snowflake ML FORECAST model · Shaded = 95% confidence band",
                showarrow=False, xref="paper", yref="paper", x=1, y=1.1,
                xanchor="right", font=dict(size=10, color="#64748b"))],
            paper_bgcolor="#ffffff", plot_bgcolor="#f8fafc", font_color="#1e293b",
            height=280, margin=dict(t=55, b=30, l=50, r=20),
            xaxis=dict(categoryorder="array", categoryarray=_period_order),
            yaxis=dict(ticksuffix="%", gridcolor="#e2e8f0"),
            legend=dict(font=dict(size=11), orientation="h", y=-0.12),
        )
        st.plotly_chart(fig_fc, use_container_width=True)

        # ── Two-column row: Risk scores + Anomaly list ───────────────────────
        rc1, rc2 = st.columns(2)

        with rc1:
            st.markdown('<div style="font-size:.9rem;font-weight:600;color:#1e293b;margin-bottom:4px">'
                        'Product Risk Scores — P004 Estimate'
                        '<span style="font-size:.72rem;color:#64748b;font-weight:400;margin-left:10px">'
                        'Linear extrapolation from trend slope</span></div>', unsafe_allow_html=True)
            risk_top = risk_df.head(8).copy()
            risk_top["MAT"] = risk_top["MATERIAL_NUMBER"].str.replace("-FIN", "", regex=False)
            risk_colors = [_RISK_COLOR.get(r, "#94a3b8") for r in risk_top["RISK_LEVEL"]]
            fig_risk = go.Figure(go.Bar(
                y=risk_top["MAT"], x=risk_top["ESTIMATED_P007"],
                orientation="h", marker_color=risk_colors, marker_line_width=0,
                hovertemplate="%{y}: %{x:.1f}% est. P004 variance<extra></extra>",
            ))
            fig_risk.add_vline(x=5, line_dash="dot", line_color="#ef4444",
                               annotation_text="5% threshold",
                               annotation_font_size=9, annotation_font_color="#ef4444")
            fig_risk.update_layout(
                paper_bgcolor="#ffffff", plot_bgcolor="#f8fafc", font_color="#1e293b",
                height=280, margin=dict(t=10, b=20, l=10, r=20),
                xaxis=dict(ticksuffix="%", gridcolor="#e2e8f0", tickfont=dict(size=9)),
                yaxis=dict(tickfont=dict(size=10)),
            )
            st.plotly_chart(fig_risk, use_container_width=True)

        with rc2:
            st.markdown('<div style="font-size:.9rem;font-weight:600;color:#1e293b;margin-bottom:4px">'
                        'Statistical Anomalies — Cost Components'
                        '<span style="font-size:.72rem;color:#64748b;font-weight:400;margin-left:10px">'
                        'Z-score > 1.5 flagged</span></div>', unsafe_allow_html=True)
            anom_html_rows = []
            for i, (_, r) in enumerate(anom_df.head(8).iterrows()):
                z = float(r["Z_SCORE"])
                sev = "HIGH" if abs(z) > 2 else "MEDIUM"
                border = "border-bottom:1px solid #e2e8f0;" if i < 7 else ""
                mat = str(r["MATERIAL_NUMBER"]).replace("-FIN","").replace("-API","")
                anom_html_rows.append(
                    f'<div style="display:flex;align-items:flex-start;gap:10px;padding:8px 0;{border}">'
                    f'<span style="font-size:.62rem;font-weight:700;padding:2px 7px;border-radius:10px;'
                    f'background:{_RISK_BG[sev]};color:{_RISK_COLOR[sev]};white-space:nowrap;margin-top:2px">{sev}</span>'
                    f'<div>'
                    f'<div style="font-size:.8rem;font-weight:600;color:#1e293b">{mat} — {r["COST_COMPONENT"]}</div>'
                    f'<div style="font-size:.72rem;color:#64748b">P{r["PERIOD"]}: '
                    f'{"+" if float(r["VARIANCE_PCT"])>0 else ""}{float(r["VARIANCE_PCT"]):.2f}% variance · z-score {float(r["Z_SCORE"]):.2f}</div>'
                    f'</div></div>'
                )
            st.markdown(
                '<div style="border:1px solid #e2e8f0;border-radius:10px;padding:12px 16px;background:#fff">'
                + "".join(anom_html_rows) + "</div>",
                unsafe_allow_html=True)

        # ── AI Recommendations ───────────────────────────────────────────────
        st.markdown('<div style="font-size:.9rem;font-weight:600;color:#1e293b;margin:16px 0 8px">'
                    'AI Recommendations — Snowflake Cortex'
                    '<span style="font-size:.72rem;color:#64748b;font-weight:400;margin-left:10px">'
                    'Based on ML forecast + anomaly detection outputs</span></div>',
                    unsafe_allow_html=True)

        if "si_reco" not in st.session_state:
            st.session_state.si_reco = ""

        if not st.session_state.si_reco:
            st.markdown('<p style="font-size:.82rem;color:#64748b;padding:4px 0 8px">'
                        'Click "Generate Recommendations" to let Cortex AI analyse the forecast and '
                        'anomaly data and produce actionable Finance recommendations.</p>',
                        unsafe_allow_html=True)
            if st.button("▶  Generate Recommendations", use_container_width=True, key="si_gen"):
                with st.spinner("Analysing ML outputs with Cortex AI…"):
                    try:
                        risk_summary = "; ".join(
                            f"{r['MATERIAL_NUMBER']} ({r['RISK_LEVEL']}): "
                            f"P001={r['VAR_P001']}%, P003={r['VAR_P003']}%, P006={r['VAR_P006']}%, "
                            f"slope={r['SLOPE']}%/period, est next={r['ESTIMATED_P007']}%"
                            for _, r in risk_df.head(10).iterrows()
                        )
                        anom_summary = "; ".join(
                            f"{r['MATERIAL_NUMBER']} — {r['COST_COMPONENT']} in P{r['PERIOD']}: "
                            f"{r['VARIANCE_PCT']}% (z-score {r['Z_SCORE']})"
                            for _, r in anom_df.head(8).iterrows()
                        )
                        fc_summary = "; ".join(
                            f"{r['PERIOD_LABEL']}: forecast {r['FORECAST_VARIANCE']}% "
                            f"(range {r['FORECAST_LOWER']}% to {r['FORECAST_UPPER']}%)"
                            for _, r in forecasts.head(3).iterrows()
                        )
                        prompt = (
                            "You are a Snowflake AI assistant for a pharmaceutical company's Finance team. "
                            "You have just run Snowflake's native ML FORECAST and anomaly detection models on SAP product cost data.\n\n"
                            f"ML RESULTS:\n- Portfolio forecast (P004-P006): {fc_summary}\n"
                            f"- Product risk scores: {risk_summary}\n"
                            f"- Statistical anomalies flagged (z-score > 1.5): {anom_summary}\n\n"
                            "Generate exactly 4 specific, actionable recommendations for the Finance and Supply Chain teams. "
                            "Reference specific products, sites, or cost components from the ML data. "
                            "State the quantified risk. Give a concrete action. "
                            "Format as numbered list. Start directly with '1.' — no preamble."
                        )
                        recs_df = query(f"SELECT AI_COMPLETE('claude-sonnet-4-5', $${prompt}$$) AS RECS")
                        st.session_state.si_reco = recs_df.iloc[0]["RECS"]
                        st.rerun()
                    except Exception as e:
                        st.error(f"AI call failed: {e}")
        else:
            st.markdown(st.session_state.si_reco)
            if st.button("↺ Regenerate", key="si_regen"):
                st.session_state.si_reco = ""
                st.rerun()


# ── ASK CORTEX AI ─────────────────────────────────────────────────────────────
with tabs[5]:
    st.subheader("Ask Cortex AI — Natural Language Q&A")
    st.caption("Powered by AI_COMPLETE (claude-sonnet-4-5) · Grounded in SAP BDC cost data")

    if "chat_history" not in st.session_state:
        st.session_state.chat_history = [
            {"role": "assistant", "content": "Hello! I'm your AI Product Costing assistant, powered by Snowflake Cortex AI.\n\nI have access to your SAP BDC cost data — standard prices, actual costs, cost component splits, and gross margin from SD billing. Ask me anything about cost variances, manufacturing site performance, or product profitability."}
        ]

    # Suggested questions
    suggestions = [
        "Which products have the highest cost variance this quarter?",
        "Show me the variance trend across all three periods",
        "Compare budget vs actual costs across all manufacturing sites",
        "Which product has the highest gross margin?",
        "Which products are most at risk for FY2026?",
    ]
    st.markdown("**Quick questions:**")
    cols = st.columns(len(suggestions))
    for i, (col, q) in enumerate(zip(cols, suggestions)):
        if col.button(q, key=f"sugg_{i}", use_container_width=True):
            st.session_state.pending_question = q

    # Display chat history with custom bubbles + inline charts
    for _ci, msg in enumerate(st.session_state.chat_history):
        if msg["role"] == "assistant":
            text, spec = _parse_chart(msg["content"])
            if text:
                render_bubble("assistant", text)
            if spec:
                render_chat_chart(spec, key=f"chat_chart_hist_{_ci}")
        else:
            render_bubble("user", msg["content"])

    # Handle pending question from suggestion button or chat input
    _ask_ai = False
    if "pending_question" in st.session_state:
        user_input = st.session_state.pop("pending_question")
        st.session_state.chat_history.append({"role": "user", "content": user_input})
        render_bubble("user", user_input)
        _ask_ai = True

    user_input = st.chat_input("Ask about cost variances, product performance, scenarios...")
    if user_input:
        st.session_state.chat_history.append({"role": "user", "content": user_input})
        render_bubble("user", user_input)
        _ask_ai = True

    if _ask_ai:
        question = st.session_state.chat_history[-1]["content"]

        # Ground the answer with live aggregates (like the React getDataContext)
        try:
            ctx_df = query("""
                SELECT
                  COUNT(DISTINCT MATERIAL_NUMBER) AS PRODUCTS,
                  COUNT(DISTINCT PLANT_CODE)      AS SITES,
                  ROUND(AVG(COST_VARIANCE_PCT), 2) AS AVG_VAR,
                  ROUND(MAX(ABS(COST_VARIANCE_PCT)), 2) AS MAX_VAR,
                  SUM(CASE WHEN COST_VARIANCE_PCT > 5 THEN 1 ELSE 0 END) AS OVER5
                FROM {DATABASE}.ANALYTICS.PRODUCT_COST_SUMMARY
                WHERE FISCAL_YEAR = 2026
            """)
            top_df = query("""
                SELECT MATERIAL_NUMBER, PLANT_NAME, PERIOD,
                       ROUND(COST_VARIANCE_PCT, 2) AS VAR
                FROM {DATABASE}.ANALYTICS.PRODUCT_COST_SUMMARY
                WHERE FISCAL_YEAR = 2026 AND MATERIAL_TYPE = 'FERT'
                ORDER BY ABS(COST_VARIANCE_PCT) DESC LIMIT 5
            """)
            c = ctx_df.iloc[0]
            top_str = "; ".join(
                f"{r.MATERIAL_NUMBER} ({r.PLANT_NAME}, P{r.PERIOD}): {r.VAR}%"
                for r in top_df.itertuples()
            )
            context = (f"Cost data - {int(c.PRODUCTS)} products, {int(c.SITES)} sites. "
                       f"Avg variance: {c.AVG_VAR}%, Max: {c.MAX_VAR}%, Over 5% threshold: {int(c.OVER5)}. "
                       f"Top 5 by variance: {top_str}.")
        except Exception:
            context = "Data context unavailable."

        system = """You are an AI assistant for a pharmaceutical company's Product Costing dashboard, powered by Snowflake Cortex AI.
You answer questions about SAP product costing and profitability data for a pharmaceutical company.
Products are RX-#### compounds (e.g. RX-1234, RX-3312) manufactured across 5 sites: Macclesfield UK, Sodertalje Sweden, Dunboyne Ireland, Mount Vernon USA, and Bangalore India. Data spans FY2024 + FY2025 (monthly) and FY2026 H1 (P001-P006); the app focuses on FY2026.
FY2026 context: API price shock in April (+9.5%), yield crisis at Dunboyne in May (+16% biologics variance), Bangalore injectables elevated in June.

RESPONSE RULES:
- NEVER write SQL queries. Never mention table names, column names, or database objects.
- Answer in plain business English as a Finance or Supply Chain analyst would. Be concise - 2-4 sentences.
- Reference specific products (AZD codes), sites, months, and percentages where relevant.
- When comparing numbers across products, sites, or periods, append a chart using EXACTLY this format after your text:
<chart type="CHART_TYPE" title="CHART_TITLE">
[{"name":"LABEL","value":NUMBER}, ...]
</chart>
Chart types: "bar" (comparisons), "line" (trends over periods), "pie" (proportions). Values must be plain numbers (no % or $ symbols).
- For questions about site locations or global operations use a map chart:
<chart type="map" title="Manufacturing Site Variance %">
[{"name":"Macclesfield","lat":53.26,"lng":-2.12,"value":7.7},{"name":"Sodertalje","lat":59.20,"lng":17.63,"value":3.2},{"name":"Dunboyne","lat":53.42,"lng":-6.48,"value":4.1},{"name":"Mount Vernon","lat":40.91,"lng":-73.84,"value":2.8},{"name":"Bangalore","lat":12.97,"lng":77.59,"value":5.6}]
</chart>
Only include a chart when it genuinely adds value - not for every answer."""

        q_esc = question.replace(chr(39), chr(39) + chr(39))
        full_prompt = f"{system}\n\nCurrent data context:\n{context}\n\nQuestion: {q_esc}\n\nAnswer:"
        with st.spinner(""):
            try:
                ans_df = query(f"SELECT AI_COMPLETE('claude-sonnet-4-5', $${full_prompt}$$) AS ANSWER")
                answer = _clean_answer(ans_df.iloc[0]["ANSWER"])
                text, spec = _parse_chart(answer)
                if text:
                    render_bubble("assistant", text)
                if spec:
                    render_chat_chart(spec, key="chat_chart_live")
                st.session_state.chat_history.append({"role": "assistant", "content": answer})
                st.rerun()
            except Exception as e:
                err = f"Sorry, I encountered an error: {e}"
                render_bubble("assistant", err)
                st.session_state.chat_history.append({"role": "assistant", "content": err})

# ── Tab 6: Data Engineering ─────────────────────────────────────────────────
with tabs[6]:
    st.markdown("""
<div style="margin-bottom:24px">
  <h3 style="font-size:1.1rem!important;margin-bottom:4px!important">Data Engineering</h3>
  <p style="font-size:.85rem;color:#64748b;margin:0">
    Raw SAP extracts flow through a <strong>dbt medallion pipeline</strong> built entirely on
    <strong>Snowflake Dynamic Tables</strong> — no tasks, no streams, no scheduling code.
    Change tracking propagates updates automatically from source to mart.
  </p>
</div>
""", unsafe_allow_html=True)

    # ── Pipeline Flow Diagram (matches React 4-column grid) ─────────────────
    st.markdown("""
<div style="display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:12px;margin-bottom:24px">
  <div style="background:#fff;border:1px solid #e2e8f0;border-radius:10px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,.06)">
    <div style="background:#fbbf24;padding:8px 12px">
      <span style="font-size:.7rem;font-weight:700;color:#78350f;text-transform:uppercase;letter-spacing:.5px">Raw / Bronze</span>
    </div>
    <div style="padding:12px;font-size:.78rem;color:#1e293b;line-height:1.7">
      <strong>SAP_RAW</strong><br>
      MARA · T001W · ML_DOC<br>
      MBEW · KEPH · TCURR<br>
      <span style="color:#64748b;font-size:.7rem">+ ENERGY_MARKET · SD_BILLING</span>
    </div>
  </div>
  <div style="background:#fff;border:1px solid #e2e8f0;border-radius:10px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,.06)">
    <div style="background:#60a5fa;padding:8px 12px">
      <span style="font-size:.7rem;font-weight:700;color:#1e3a5f;text-transform:uppercase;letter-spacing:.5px">Staging</span>
    </div>
    <div style="padding:12px;font-size:.78rem;color:#1e293b;line-height:1.7">
      <strong>stg_*</strong> (8 DTs)<br>
      Clean · trim · type-cast<br>
      Decode element codes<br>
      <span style="color:#64748b;font-size:.7rem">target_lag: DOWNSTREAM</span>
    </div>
  </div>
  <div style="background:#fff;border:1px solid #e2e8f0;border-radius:10px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,.06)">
    <div style="background:#a78bfa;padding:8px 12px">
      <span style="font-size:.7rem;font-weight:700;color:#3b0764;text-transform:uppercase;letter-spacing:.5px">Intermediate</span>
    </div>
    <div style="padding:12px;font-size:.78rem;color:#1e293b;line-height:1.7">
      <strong>int_*</strong> (4 DTs)<br>
      Unit costs · FX convert<br>
      Budget join · Std reset<br>
      <span style="color:#64748b;font-size:.7rem">target_lag: DOWNSTREAM</span>
    </div>
  </div>
  <div style="background:#fff;border:1px solid #e2e8f0;border-radius:10px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,.06)">
    <div style="background:#34d399;padding:8px 12px">
      <span style="font-size:.7rem;font-weight:700;color:#064e3b;text-transform:uppercase;letter-spacing:.5px">Marts</span>
    </div>
    <div style="padding:12px;font-size:.78rem;color:#1e293b;line-height:1.7">
      <strong>mart_*</strong> (9 DTs)<br>
      Cost · Variance · Profit<br>
      Energy bridge · Risk<br>
      <span style="color:#64748b;font-size:.7rem">target_lag: 1 hour</span>
    </div>
  </div>
</div>
""", unsafe_allow_html=True)

    # ── KPI Scorecard ───────────────────────────────────────────────────────
    try:
        layer_counts = query("""
            SELECT
                COUNT_IF(TABLE_NAME ILIKE 'STG_%') AS STAGING,
                COUNT_IF(TABLE_NAME ILIKE 'INT_%') AS INTERMEDIATE,
                COUNT_IF(TABLE_NAME ILIKE 'MART_%') AS MARTS,
                COUNT(*) AS TOTAL
            FROM {DATABASE}.INFORMATION_SCHEMA.TABLES
            WHERE TABLE_SCHEMA = 'DBT_ANALYTICS' AND TABLE_TYPE = 'BASE TABLE'
        """)
        c1, c2, c3, c4 = st.columns(4)
        c1.metric("Staging DTs", int(layer_counts.iloc[0]["STAGING"]))
        c2.metric("Intermediate DTs", int(layer_counts.iloc[0]["INTERMEDIATE"]))
        c3.metric("Mart DTs", int(layer_counts.iloc[0]["MARTS"]))
        c4.metric("Total Pipeline", int(layer_counts.iloc[0]["TOTAL"]))
    except Exception:
        pass

    # ── Dynamic Table Status Table ──────────────────────────────────────────
    st.markdown("#### Dynamic Table Inventory")
    try:
        dt_inv = query("""
            SELECT TABLE_NAME AS NAME, ROW_COUNT, BYTES,
                   ROUND(BYTES / 1024.0 / 1024.0, 2) AS SIZE_MB
            FROM {DATABASE}.INFORMATION_SCHEMA.TABLES
            WHERE TABLE_SCHEMA = 'DBT_ANALYTICS' AND TABLE_TYPE = 'BASE TABLE'
            ORDER BY TABLE_NAME
        """)
        if dt_inv is not None and len(dt_inv) > 0:
            html = styled_table(dt_inv, fmt={"ROW_COUNT": "{:,.0f}", "SIZE_MB": "{:.2f}"})
            st.markdown(html, unsafe_allow_html=True)
    except Exception as e:
        st.info(f"Inventory unavailable: {e}")

    # ── Refresh History ─────────────────────────────────────────────────────
    st.markdown("#### Recent Refresh Activity")
    try:
        refresh_hist = query("""
            SELECT NAME, STATE, REFRESH_ACTION,
                   REFRESH_TRIGGER,
                   DATEDIFF('second', REFRESH_START_TIME, REFRESH_END_TIME) AS DURATION_SECS
            FROM TABLE({DATABASE}.INFORMATION_SCHEMA.DYNAMIC_TABLE_REFRESH_HISTORY())
            WHERE SCHEMA_NAME = 'DBT_ANALYTICS'
            ORDER BY REFRESH_START_TIME DESC
            LIMIT 15
        """)
        if refresh_hist is not None and len(refresh_hist) > 0:
            html = styled_table(refresh_hist, variance_cols=["STATE"])
            st.markdown(html, unsafe_allow_html=True)
        else:
            st.info("No refresh history yet — DTs refresh on their configured lag.")
    except Exception as e:
        st.info(f"Refresh history requires DYNAMIC_TABLE_REFRESH_HISTORY access.")

    # ── Reconciliation ──────────────────────────────────────────────────────
    st.markdown("#### Reconciliation — dbt Marts vs Curated Views")
    try:
        recon = query("""
            SELECT MART, MART_ROWS, VIEW_ROWS,
                   CASE WHEN MART_ROWS = VIEW_ROWS THEN '✓ Match' ELSE '✗ Mismatch' END AS STATUS
            FROM (
                SELECT 'mart_product_cost' AS MART,
                       (SELECT COUNT(*) FROM {DATABASE}.DBT_ANALYTICS.MART_PRODUCT_COST WHERE MATERIAL_TYPE='FERT') AS MART_ROWS,
                       (SELECT COUNT(*) FROM {DATABASE}.ANALYTICS.PRODUCT_COST_SUMMARY WHERE MATERIAL_TYPE='FERT') AS VIEW_ROWS
                UNION ALL
                SELECT 'mart_cost_component_detail',
                       (SELECT COUNT(*) FROM {DATABASE}.DBT_ANALYTICS.MART_COST_COMPONENT_DETAIL),
                       (SELECT COUNT(*) FROM {DATABASE}.ANALYTICS.COST_COMPONENT_DETAIL)
            )
        """)
        html = styled_table(recon, variance_cols=["STATUS"])
        st.markdown(html, unsafe_allow_html=True)
    except Exception as e:
        st.info(f"Reconciliation: {e}")

# ── Tab 7: Observability & Trust ────────────────────────────────────────────
with tabs[7]:
    st.markdown("""
<div style="margin-bottom:20px">
  <h3 style="font-size:1.1rem!important;margin-bottom:4px!important">Observability &amp; Trust</h3>
  <p style="font-size:.85rem;color:#64748b;margin:0">
    Live signals on <strong>data quality</strong>, <strong>ML model accuracy</strong>,
    and <strong>platform consumption</strong> — the trust layer that lets stakeholders
    self-serve with confidence.
  </p>
</div>
""", unsafe_allow_html=True)

    # ── Data Quality ────────────────────────────────────────────────────────
    try:
        dq = query("""
            SELECT
                COUNT(*)                                                        AS TOTAL_ROWS,
                COUNT(DISTINCT MATERIAL_NUMBER)                                 AS MATERIALS,
                COUNT(DISTINCT PLANT_CODE)                                      AS PLANTS,
                MAX(YEAR_PERIOD)                                                AS LATEST_PERIOD,
                ROUND(100.0 * COUNT(ACTUAL_COST_PER_UNIT) / NULLIF(COUNT(*),0), 1) AS PCT_ACTUAL,
                ROUND(100.0 * COUNT(BUDGET_COST_PER_UNIT) / NULLIF(COUNT(*),0), 1) AS PCT_BUDGET,
                ROUND(100.0 * COUNT_IF(ABS(COST_VARIANCE_PCT) <= 5) / NULLIF(COUNT(*),0), 1) AS PCT_TOLERANCE
            FROM {DATABASE}.DBT_ANALYTICS.MART_PRODUCT_COST
            WHERE FISCAL_YEAR = 2026 AND MATERIAL_TYPE = 'FERT'
        """)
        dupes = query("""
            SELECT COUNT(*) AS DUPLICATE_KEYS FROM (
                SELECT BWKEY, MATNR, GJAHR, POPER, COUNT(*) c
                FROM {DATABASE}.SAP_BDC.MATERIAL_LEDGER
                GROUP BY 1,2,3,4 HAVING COUNT(*) > 1
            )
        """)
        dup_count = int(dupes.iloc[0]["DUPLICATE_KEYS"])
        dup_html = f'<span style="color:#166534;font-weight:600">✓ 0 duplicates</span>' if dup_count == 0 else f'<span style="color:#dc2626;font-weight:600">✗ {dup_count} duplicates</span>'

        st.markdown(f"""
<div style="background:#fff;border:1px solid #e2e8f0;border-radius:10px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,.06);margin-bottom:20px">
  <div style="background:#f0fdf4;padding:10px 16px;border-bottom:1px solid #e2e8f0;display:flex;justify-content:space-between;align-items:center">
    <span style="font-size:.78rem;font-weight:700;color:#166534;text-transform:uppercase;letter-spacing:.5px">Data Quality</span>
    {dup_html}
  </div>
  <div style="padding:16px">
    <div style="display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:16px;margin-bottom:16px">
      <div><div style="font-size:.68rem;color:#64748b;text-transform:uppercase;letter-spacing:.4px;margin-bottom:4px">Rows (FY26)</div><div style="font-size:1.4rem;font-weight:700;color:#1e293b">{int(dq.iloc[0]['TOTAL_ROWS']):,}</div></div>
      <div><div style="font-size:.68rem;color:#64748b;text-transform:uppercase;letter-spacing:.4px;margin-bottom:4px">Materials</div><div style="font-size:1.4rem;font-weight:700;color:#1e293b">{int(dq.iloc[0]['MATERIALS'])}</div></div>
      <div><div style="font-size:.68rem;color:#64748b;text-transform:uppercase;letter-spacing:.4px;margin-bottom:4px">Plants</div><div style="font-size:1.4rem;font-weight:700;color:#1e293b">{int(dq.iloc[0]['PLANTS'])}</div></div>
      <div><div style="font-size:.68rem;color:#64748b;text-transform:uppercase;letter-spacing:.4px;margin-bottom:4px">Latest Period</div><div style="font-size:1.4rem;font-weight:700;color:#1e293b">{dq.iloc[0]['LATEST_PERIOD']}</div></div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:16px">
      <div><div style="font-size:.68rem;color:#64748b;text-transform:uppercase;letter-spacing:.4px;margin-bottom:4px">Actual Cost Coverage</div><div style="font-size:1.4rem;font-weight:700;color:#166534">{dq.iloc[0]['PCT_ACTUAL']}%</div></div>
      <div><div style="font-size:.68rem;color:#64748b;text-transform:uppercase;letter-spacing:.4px;margin-bottom:4px">Budget Coverage</div><div style="font-size:1.4rem;font-weight:700;color:#166534">{dq.iloc[0]['PCT_BUDGET']}%</div></div>
      <div><div style="font-size:.68rem;color:#64748b;text-transform:uppercase;letter-spacing:.4px;margin-bottom:4px">Within ±5% Tolerance</div><div style="font-size:1.4rem;font-weight:700;color:{'#166534' if float(dq.iloc[0]['PCT_TOLERANCE']) > 50 else '#dc2626'}">{dq.iloc[0]['PCT_TOLERANCE']}%</div></div>
    </div>
  </div>
</div>
""", unsafe_allow_html=True)
    except Exception as e:
        st.warning(f"Data quality unavailable: {e}")

    # ── Model Accuracy ──────────────────────────────────────────────────────
    try:
        acc = query(f"SELECT * FROM {DATABASE}.ANALYTICS.FORECAST_ACCURACY")
        if acc is not None and len(acc) > 0:
            st.markdown(f"""
<div style="background:#fff;border:1px solid #e2e8f0;border-radius:10px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,.06);margin-bottom:20px">
  <div style="background:#eff6ff;padding:10px 16px;border-bottom:1px solid #e2e8f0">
    <span style="font-size:.78rem;font-weight:700;color:#1e40af;text-transform:uppercase;letter-spacing:.5px">ML Forecast Accuracy — Backtest</span>
  </div>
  <div style="padding:16px">
    <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:16px;margin-bottom:8px">
      <div><div style="font-size:.68rem;color:#64748b;text-transform:uppercase;letter-spacing:.4px;margin-bottom:4px">MAE (pp)</div><div style="font-size:1.4rem;font-weight:700;color:#1e293b">{acc.iloc[0].iloc[0]:.2f}</div></div>
      <div><div style="font-size:.68rem;color:#64748b;text-transform:uppercase;letter-spacing:.4px;margin-bottom:4px">RMSE (pp)</div><div style="font-size:1.4rem;font-weight:700;color:#1e293b">{acc.iloc[0].iloc[1]:.2f}</div></div>
      <div><div style="font-size:.68rem;color:#64748b;text-transform:uppercase;letter-spacing:.4px;margin-bottom:4px">Within CI</div><div style="font-size:1.4rem;font-weight:700;color:#1e293b">{acc.iloc[0].iloc[2]:.0f}%</div></div>
    </div>
  </div>
</div>
""", unsafe_allow_html=True)

        detail = query("""
            SELECT PERIOD_LABEL, ACTUAL_VARIANCE, FORECAST_VARIANCE, ABS_ERROR_PP, WITHIN_CI
            FROM {DATABASE}.ANALYTICS.FORECAST_BACKTEST_DETAIL ORDER BY TS
        """)
        if detail is not None and len(detail) > 0:
            fig_bt = go.Figure()
            fig_bt.add_trace(go.Scatter(
                x=detail["PERIOD_LABEL"], y=detail["ACTUAL_VARIANCE"],
                name="Actual", line=dict(color="#1e293b", width=2.5),
                mode="lines+markers", marker=dict(size=5)))
            fig_bt.add_trace(go.Scatter(
                x=detail["PERIOD_LABEL"], y=detail["FORECAST_VARIANCE"],
                name="Forecast", line=dict(color="#29b5e8", width=2.5, dash="dot"),
                mode="lines+markers", marker=dict(size=5)))
            fig_bt.update_layout(
                yaxis_title="Avg Variance %", xaxis_title="",
                template="plotly_white", height=260,
                margin=dict(t=10, b=40, l=50, r=20),
                legend=dict(orientation="h", y=1.08, x=0.5, xanchor="center"))
            st.plotly_chart(fig_bt, use_container_width=True)
    except Exception as e:
        st.info(f"Forecast backtest not available: {e}")

    # ── Consumption ─────────────────────────────────────────────────────────
    try:
        compute = query(f"""
            SELECT
                ROUND(SUM(IFF(NAME ILIKE '{WAREHOUSE}', CREDITS_USED, 0)), 2) AS APC_WH,
                ROUND(SUM(CREDITS_USED), 2) AS ACCOUNT_TOTAL,
                COUNT(DISTINCT NAME) AS SERVICES
            FROM SNOWFLAKE.ACCOUNT_USAGE.METERING_HISTORY
            WHERE START_TIME >= DATEADD('day', -14, CURRENT_TIMESTAMP())
        """)
        cortex_credits = 0
        cortex_tokens = 0
        cortex_calls = 0
        try:
            cortex = query("""
                SELECT
                    COALESCE(ROUND(SUM(TOKEN_CREDITS), 4), 0) AS CREDITS,
                    COALESCE(SUM(TOKENS), 0) AS TOKENS,
                    COUNT(*) AS CALLS
                FROM SNOWFLAKE.ACCOUNT_USAGE.CORTEX_FUNCTIONS_USAGE_HISTORY
                WHERE START_TIME >= DATEADD('day', -14, CURRENT_TIMESTAMP())
            """)
            cortex_credits = cortex.iloc[0]["CREDITS"]
            cortex_tokens = int(cortex.iloc[0]["TOKENS"])
            cortex_calls = int(cortex.iloc[0]["CALLS"])
        except Exception:
            pass

        st.markdown(f"""
<div style="background:#fff;border:1px solid #e2e8f0;border-radius:10px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,.06);margin-bottom:20px">
  <div style="background:#faf5ff;padding:10px 16px;border-bottom:1px solid #e2e8f0">
    <span style="font-size:.78rem;font-weight:700;color:#6b21a8;text-transform:uppercase;letter-spacing:.5px">Platform Consumption (14 days)</span>
  </div>
  <div style="padding:16px">
    <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:16px;margin-bottom:{'16px' if cortex_calls > 0 else '0'}">
      <div><div style="font-size:.68rem;color:#64748b;text-transform:uppercase;letter-spacing:.4px;margin-bottom:4px">APC Warehouse</div><div style="font-size:1.4rem;font-weight:700;color:#1e293b">{compute.iloc[0]['APC_WH']}</div><div style="font-size:.68rem;color:#64748b">credits</div></div>
      <div><div style="font-size:.68rem;color:#64748b;text-transform:uppercase;letter-spacing:.4px;margin-bottom:4px">Account Total</div><div style="font-size:1.4rem;font-weight:700;color:#1e293b">{compute.iloc[0]['ACCOUNT_TOTAL']}</div><div style="font-size:.68rem;color:#64748b">credits</div></div>
      <div><div style="font-size:.68rem;color:#64748b;text-transform:uppercase;letter-spacing:.4px;margin-bottom:4px">Active Services</div><div style="font-size:1.4rem;font-weight:700;color:#1e293b">{int(compute.iloc[0]['SERVICES'])}</div></div>
    </div>
    {"<div style='display:grid;grid-template-columns:1fr 1fr 1fr;gap:16px'><div><div style=" + '"font-size:.68rem;color:#64748b;text-transform:uppercase;letter-spacing:.4px;margin-bottom:4px"' + ">Cortex AI Credits</div><div style=" + '"font-size:1.4rem;font-weight:700;color:#6b21a8"' + f">{cortex_credits}</div></div><div><div style=" + '"font-size:.68rem;color:#64748b;text-transform:uppercase;letter-spacing:.4px;margin-bottom:4px"' + ">Tokens</div><div style=" + '"font-size:1.4rem;font-weight:700;color:#6b21a8"' + f">{cortex_tokens:,}</div></div><div><div style=" + '"font-size:.68rem;color:#64748b;text-transform:uppercase;letter-spacing:.4px;margin-bottom:4px"' + ">API Calls</div><div style=" + '"font-size:1.4rem;font-weight:700;color:#6b21a8"' + f">{cortex_calls}</div></div></div>" if cortex_calls > 0 else ""}
  </div>
</div>
""", unsafe_allow_html=True)
    except Exception:
        st.info("Consumption metrics require SNOWFLAKE.ACCOUNT_USAGE access — skipped.")

    # ── DT Freshness Table ──────────────────────────────────────────────────
    st.markdown("""
<div style="background:#fff;border:1px solid #e2e8f0;border-radius:10px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,.06)">
  <div style="background:#f8fafc;padding:10px 16px;border-bottom:1px solid #e2e8f0">
    <span style="font-size:.78rem;font-weight:700;color:#334155;text-transform:uppercase;letter-spacing:.5px">Dynamic Table Freshness</span>
  </div>
</div>
""", unsafe_allow_html=True)
    try:
        dt_fresh = query("""
            SELECT TABLE_NAME AS NAME, ROW_COUNT,
                   LAST_ALTERED AS LAST_REFRESH
            FROM {DATABASE}.INFORMATION_SCHEMA.TABLES
            WHERE TABLE_SCHEMA = 'DBT_ANALYTICS' AND TABLE_TYPE = 'BASE TABLE'
            ORDER BY LAST_ALTERED DESC
        """)
        if dt_fresh is not None and len(dt_fresh) > 0:
            html = styled_table(dt_fresh, fmt={"ROW_COUNT": "{:,.0f}"})
            st.markdown(html, unsafe_allow_html=True)
    except Exception as e:
        st.info(f"Freshness data unavailable: {e}")
