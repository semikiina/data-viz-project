// -------------------------------------------
// LOAD CSV + BUILD EVERYTHING
// -------------------------------------------
d3.csv("data/leagues_data_filled.csv").then(function (data) {
  // -------------------------------------------
  // #region 1. DATA PREPROCESSING & ATTRIBUTE CONFIG
  // -------------------------------------------
  const ignoreKeys = new Set([
    "team_fifa_api_id",
    "team_api_id",
    "league_name_id",
    "date",
    "buildUpPlaySpeedClass",
    "buildUpPlayDribblingClass",
    "buildUpPlayPassingClass",
    "chanceCreationShootingClass",
    "chanceCreationCrossingClass",
    "chanceCreationPassingClass",
    "defencePressureClass",
    "defenceAggressionClass",
    "defenceTeamWidthClass",
  ]);
  const ordinalMappings = {
    buildUpPlayPositioningClass: { Organised: 1, "Free Form": 2 },
    chanceCreationPositioningClass: { Organised: 1, "Free Form": 2 },
    defenceDefenderLineClass: { Cover: 1, "Offside Trap": 2 },
  };
  const ordinalLabels = {};
  for (const key in ordinalMappings) {
    ordinalLabels[key] = {};
    for (const label in ordinalMappings[key]) {
      ordinalLabels[key][ordinalMappings[key][label]] = label;
    }
  }
  const filteredData = data.map((row) => {
    const newRow = {
      league_name: row["league_name"],
      team_name: row["team_name"],
    };
    for (const key in row) {
      if (
        !ignoreKeys.has(key) &&
        key !== "league_name" &&
        key !== "team_name"
      ) {
        if (ordinalMappings[key]) {
          const val = row[key];
          newRow[key] =
            ordinalMappings[key][val] !== undefined
              ? ordinalMappings[key][val]
              : null;
          newRow[key + "_label"] = val;
        } else {
          newRow[key] = row[key];
        }
      }
    }
    return newRow;
  });

  const attributeTitles = {
    buildUpPlaySpeed: "Speed",
    buildUpPlayDribbling: "Dribbling",
    buildUpPlayPassing: "Passing",
    buildUpPlayPositioningClass: "Positioning",
    chanceCreationPassing: "Creation Passing",
    chanceCreationCrossing: "Creation Crossing",
    chanceCreationShooting: "Creation Shooting",
    chanceCreationPositioningClass: "Creation Positioning",
    defencePressure: "Pressure",
    defenceAggression: "Aggression",
    defenceTeamWidth: "Team Width",
    defenceDefenderLineClass: "Defender Line",
  };

  // Attribute groups and weights
  const attributeGroups = {
    "Build Up": [
      "buildUpPlaySpeed",
      "buildUpPlayDribbling",
      "buildUpPlayPassing",
      "buildUpPlayPositioningClass",
    ],
    "Chance Creation": [
      "chanceCreationPassing",
      "chanceCreationCrossing",
      "chanceCreationShooting",
      "chanceCreationPositioningClass",
    ],
    Defence: [
      "defencePressure",
      "defenceAggression",
      "defenceTeamWidth",
      "defenceDefenderLineClass",
    ],
  };
  const weightedAttributes = Object.values(attributeGroups).flat();
  let attributeWeights = {};
  weightedAttributes.forEach((a) => (attributeWeights[a] = 1));

  //#endregion

  // -------------------------------------------
  // #region 2. PARASOL (PARALLEL COORDINATES) LOGIC
  // -------------------------------------------

  let currentColorMode = "league";
  let currentClusterK = 12;
  let currentParasolData = null;
  // current alpha/opacity for PCP lines
  let currentAlpha = 0.1;
  // current smoothness value (0-1)
  let currentSmoothness = 0;
  // current bundling strength (0-1)
  let currentBundling = 0;
  // Track selected teams to persist across rebuilds
  let selectedTeamNames = [];
  let gridInstance = null;

  const angryRainbow = d3.scaleSequential((t) =>
    d3.hsl(t * 360, 1, 0.5).toString()
  );

  // Map columns to their types
  function getColumnType(col) {
    if (col === "team_name" || col === "league_name") return "Team";
    if (
      [
        "buildUpPlaySpeed",
        "buildUpPlayDribbling",
        "buildUpPlayPassing",
        "buildUpPlayPositioningClass",
      ].includes(col)
    )
      return "Build Up";
    if (
      [
        "chanceCreationPassing",
        "chanceCreationCrossing",
        "chanceCreationShooting",
        "chanceCreationPositioningClass",
      ].includes(col)
    )
      return "Chance Creation";
    if (
      [
        "defencePressure",
        "defenceAggression",
        "defenceTeamWidth",
        "defenceDefenderLineClass",
      ].includes(col)
    )
      return "Defence";
    return "";
  }

  function computeWeightedScores(data) {
    data.forEach((d) => {
      let sum = 0,
        totalW = 0;
      for (const [attr, w] of Object.entries(attributeWeights)) {
        if (d[attr] !== undefined && !isNaN(+d[attr])) {
          sum += +d[attr] * w;
          totalW += w;
        }
      }
      d.weightedScore = totalW > 0 ? sum / totalW : 0;
    });
    return data;
  }

  function applyColoring(psInstance, mode, dataForParasol) {
    if (!psInstance) return;
    const modeLower = (mode || "league").toLowerCase();

    if (modeLower === "league") {
      const leagues = Array.from(
        new Set(
          (dataForParasol || psInstance.state.data).map((d) => d.league_name)
        )
      );
      const leagueColor = d3
        .scaleOrdinal()
        .domain(leagues)
        .range(d3.schemeCategory10);
      psInstance.color((d) => leagueColor(d.league_name)).render();
    } else if (modeLower === "cluster") {
      const data = dataForParasol || psInstance.state.data;
      const clusters = Array.from(new Set(data.map((d) => d.cluster)));
      const clusterPalette = d3
        .scaleOrdinal()
        .domain(clusters)
        .range(
          clusters.map((_, i) =>
            angryRainbow(clusters.length === 1 ? 0 : i / (clusters.length - 1))
          )
        );
      psInstance.color((d) => clusterPalette(d.cluster)).render();
    } else if (modeLower === "weighted") {
      const domain = d3.extent(dataForParasol, (d) => +d.weightedScore);
      const colorScale = d3
        .scaleSequential(d3.interpolateYlOrRd)
        .domain(domain);
      psInstance.color((d) => colorScale(+d.weightedScore)).render();
    }
  }

  function reapplyOrdinalLabels() {
    setTimeout(() => {
      const parcoordsSvg = d3.select(".parcoords svg");
      if (!parcoordsSvg.empty()) {
        parcoordsSvg.selectAll(".dimension").each(function () {
          const dimGroup = d3.select(this);
          const axisTitle = dimGroup.select(".label").text();
          if (ordinalLabels[axisTitle]) {
            dimGroup.selectAll(".tick").each(function () {
              const tick = d3.select(this);
              const textEl = tick.select("text");
              const numValue = parseFloat(textEl.text());
              if (!isNaN(numValue)) {
                const mapped = ordinalLabels[axisTitle][numValue];
                if (mapped) textEl.text(mapped);
                else tick.style("display", "none");
              }
            });
          }
        });
      }
    }, 10);
  }

  function initParasol(dataForParasol) {
    if (!Array.isArray(dataForParasol)) dataForParasol = [];
    document.querySelector(".parcoords").innerHTML = "";

    const psBase = Parasol(dataForParasol)(".parcoords")
      .reorderable()
      .linked()
      .alpha(currentAlpha);

    const keys = dataForParasol.length ? Object.keys(dataForParasol[0]) : [];
    const numericVars = keys.filter(
      (k) =>
        k !== "league_name" &&
        k !== "team_name" &&
        dataForParasol.some((d) => !isNaN(+d[k]))
    );
    let psLocal = psBase;
    if (numericVars.length > 0) {
      psLocal = psBase.cluster({
        k: currentClusterK,
        vars: numericVars,
        hidden: false,
      });
    }
    psLocal = psLocal.render();

    // Apply saved smoothness and bundling settings
    if (currentSmoothness > 0) {
      psLocal.smoothness(currentSmoothness);
    }
    if (currentBundling > 0) {
      psLocal.bundlingStrength(currentBundling).bundleDimension("cluster");
    }
    if (currentSmoothness > 0 || currentBundling > 0) {
      psLocal.render();
    }

    // Store grid instance and restore selections
    setTimeout(() => {
      // Try to get grid instance from the container via jQuery data
      const $gridContainer = window.$ ? window.$('#grid') : null;
      if ($gridContainer && $gridContainer.length) {
        const dataKeys = $gridContainer.data();
        // Check for grid in jQuery data
        for (let key in dataKeys) {
          const val = dataKeys[key];
          if (val && typeof val === 'object' && val.getSelectedRows) {
            gridInstance = val;
            restoreGridSelections();
            break;
          }
        }
      }
      // Alternative: look for SlickGrid directly in grid children
      if (!gridInstance) {
        const gridDiv = document.getElementById('grid');
        if (gridDiv && gridDiv.children.length > 0) {
          for (let child of gridDiv.children) {
            if (child.slickGrid) {
              gridInstance = child.slickGrid;
              restoreGridSelections();
              break;
            }
          }
        }
      }
    }, 150);

    setTimeout(reapplyOrdinalLabels, 10);
    currentParasolData = dataForParasol;
    applyColoring(psLocal, currentColorMode, dataForParasol);

    // Hide axes logic
    const uniqueLeagues = Array.from(
      new Set(dataForParasol.map((d) => d.league_name))
    );
    if (uniqueLeagues.length === 1 && psLocal.hideAxes) {
      psLocal.hideAxes(["league_name"]);
      psLocal.showAxes(["team_name"]);
      psLocal.alpha(0.5).render();
    } else if (psLocal.showAxes) {
      psLocal.showAxes(["league_name"]);
      psLocal.hideAxes(["team_name"]);
    }

    // Sliders
    d3.select("#bundling").on("input", function () {
      currentBundling = +this.value / 100;
      psLocal
        .bundlingStrength(currentBundling)
        .bundleDimension("cluster")
        .render();
      reapplyOrdinalLabels();
    });
    d3.select("#smoothness").on("input", function () {
      currentSmoothness = +this.value / 100;
      psLocal.smoothness(currentSmoothness).render();
      reapplyOrdinalLabels();
    });
    d3.select("#alpha").on("input", function () {
      currentAlpha = +this.value / 100;
      psLocal.alpha(currentAlpha).render();
      reapplyOrdinalLabels();
    });

    return psLocal;
  }

  function renderEmptyParasol() {
    document.querySelector(".parcoords").innerHTML = "";
    document.querySelector("#grid").innerHTML = "";
    currentParasolData = [];
  }
  // #endregion

  // -------------------------------------------
  // #region 3. WEIGHT SLIDERS UI
  // -------------------------------------------
  const weightDiv = d3
    .select("#weight-sliders")
    .style("display", "flex")
    .style("flex-direction", "column")
    .style("gap", "10px");

  function renderWeightSliders() {
    const panel = weightDiv;
    panel.html("");
    if (selectedAttributes.length === 0) {
      panel
        .append("div")
        .style("font-size", "13px")
        .style("color", "#666")
        .style("padding", "6px")
        .text("Select attributes in the heatmap to adjust their weights.");
      return;
    }
    const groups = ["Build Up", "Chance Creation", "Defence"];
    groups.forEach((groupName) => {
      const attrsInGroup = attributeGroups[groupName].filter((a) =>
        selectedAttributes.includes(a)
      );
      if (attrsInGroup.length === 0) return;
      panel
        .append("div")
        .style("font-weight", "600")
        .style("color", "#1565c0")
        .style("margin-top", "6px")
        .text(groupName);
      attrsInGroup.forEach((attr) => {
        const row = panel
          .append("div")
          .style("display", "flex")
          .style("align-items", "center")
          .style("gap", "6px");
        row
          .append("span")
          .style("flex", "1")
          .style("font-size", "12.5px")
          .style("overflow", "hidden")
          .style("text-overflow", "ellipsis")
          .style("white-space", "nowrap")
          .text(attr);
        row
          .append("input")
          .attr("type", "range")
          .attr("min", 0)
          .attr("max", 2)
          .attr("step", 0.1)
          .attr("value", attributeWeights[attr])
          .style("width", "80px")
          .on("input", function () {
            attributeWeights[attr] = +this.value;
          });
      });
    });
    panel
      .append("button")
      .attr("id", "apply-weights")
      .text("Apply Weights")
      .style("display", "block")
      .style("margin", "12px auto")
      .style("padding", "6px 14px")
      .style("font-size", "13px")
      .style("border", "1.5px solid #1565c0")
      .style("border-radius", "6px")
      .style("background", "white")
      .style("color", "#1565c0")
      .style("cursor", "pointer")
      .style("font-weight", "600")
      .on("mouseover", function () {
        d3.select(this).style("background", "#1565c0").style("color", "white");
      })
      .on("mouseout", function () {
        d3.select(this).style("background", "white").style("color", "#1565c0");
      })
      .on("click", function () {
        computeWeightedScores(filteredData);
        rebuildParasolFromSelection();
      });
  }
  // #endregion

  // -------------------------------------------
  // #region 4. HEATMAP LOGIC (Plotly)
  // -------------------------------------------
  const heatmapAttributes = [
    "buildUpPlaySpeed",
    "buildUpPlayDribbling",
    "buildUpPlayPassing",
    "buildUpPlayPositioningClass",
    "chanceCreationPassing",
    "chanceCreationCrossing",
    "chanceCreationShooting",
    "chanceCreationPositioningClass",
    "defencePressure",
    "defenceAggression",
    "defenceTeamWidth",
    "defenceDefenderLineClass",
  ];

  function getLeagueAttributeMeans(leagueName) {
    const leagueRows =
      leagueName === "All Leagues"
        ? filteredData
        : filteredData.filter((d) => d.league_name === leagueName);
    const means = {};
    heatmapAttributes.forEach((attr) => {
      const vals = leagueRows.map((d) => +d[attr]).filter((v) => !isNaN(v));
      means[attr] = d3.mean(vals);
    });
    return means;
  }

  function renderLeagueHeatmap(leagueSelection) {
    const selected = Array.isArray(leagueSelection)
      ? leagueSelection
      : [leagueSelection];
    if (selected.length === 0) {
      try {
        Plotly.purge("heatmap");
      } catch (e) {}
      const hm = document.getElementById("heatmap");
      if (hm)
        hm.innerHTML =
          '<div style="padding:8px;color:#555;">No leagues selected.</div>';
      return;
    }
    const hm = document.getElementById("heatmap");
    if (hm) hm.innerHTML = "";
    const useAll = selected.includes("All Leagues");
    const leagueRows = useAll
      ? filteredData
      : filteredData.filter((d) => selected.includes(d.league_name));

    // Only show selectedColumns in the heatmap
    if (!selectedColumns || selectedColumns.length === 0) {
      const hm = document.getElementById("heatmap");
      if (hm)
        hm.innerHTML =
          '<div style="padding:8px;color:#555;">Start by selecting some columns</div>';
      return;
    }

    // Use only selectedColumns for the heatmap
    const attrs = selectedColumns.slice();
    const attrValues = attrs.map((attr) =>
      leagueRows.map((d) => {
        const n = +d[attr];
        return isNaN(n) ? null : n;
      })
    );

    function pearson(xArr, yArr) {
      const pairsX = [],
        pairsY = [];
      for (let i = 0; i < xArr.length; i++) {
        const x = xArr[i],
          y = yArr[i];
        if (x !== null && y !== null) {
          pairsX.push(x);
          pairsY.push(y);
        }
      }
      const n = pairsX.length;
      if (n === 0) return 0;
      const meanX = d3.mean(pairsX),
        meanY = d3.mean(pairsY);
      let num = 0,
        denomX = 0,
        denomY = 0;
      for (let i = 0; i < n; i++) {
        const dx = pairsX[i] - meanX,
          dy = pairsY[i] - meanY;
        num += dx * dy;
        denomX += dx * dx;
        denomY += dy * dy;
      }
      const denom = Math.sqrt(denomX * denomY);
      if (denom === 0) return 0;
      return num / denom;
    }

    // Compute correlation matrix for selected columns
    const matrix = attrs.map((a, i) =>
      attrs.map((b, j) =>
        i === j ? 1 : pearson(attrValues[i], attrValues[j])
      )
    );
    const clamped = matrix.map((row) =>
      row.map((v) => Math.max(-1, Math.min(1, v)))
    );
    const yAttrs = attrs.slice().reverse();
    const zReordered = clamped.slice().reverse();
    const textReordered = zReordered.map((row) => row.map((v) => v.toFixed(2)));

    document.getElementById(
      "heatmap-title"
    ).textContent = `Attribute Correlation Heatmap`;

    Plotly.newPlot(
      "heatmap",
      [
        {
          z: zReordered,
          x: attrs,
          y: yAttrs,
          type: "heatmap",
          colorscale: [
            [0, '#7b3294'],    // Purple (negative)
            [0.5, '#f7f7f7'],  // White (neutral)
            [1, '#e66101'],
          ],
          zmin: -1,
          zmax: 1,
          showscale: true,
          colorbar: { tickvals: [-1, -0.5, 0, 0.5, 1] },
          text: textReordered,
          texttemplate: "%{text}",
          hoverinfo: "text+z",
        },
      ],
      {
        width: null,
        height: null,
        autosize: true,
        margin: { l: 60, r: 120, t: 20, b: 160 },
        xaxis: { automargin: true, tickangle: -30, tickfont: { size: 10 } },
        yaxis: { automargin: true, tickfont: { size: 10 } },
      },
      { responsive: true, displayModeBar: false }
    );
    // Make heatmap fill parent container
    const heatmapDiv = document.getElementById("heatmap");
    if (heatmapDiv) {
      heatmapDiv.style.width = "100%";
      heatmapDiv.style.height = "100%";
    }
    Plotly.Plots.resize("heatmap");
    setupLabelClickHandling();
  }
  // #endregion

  // -------------------------------------------
  // #region 5. DROPDOWNS & SELECTION LOGIC
  // -------------------------------------------
  const leagues = Array.from(new Set(data.map((d) => d.league_name))).sort();
  let selectedLeagues = leagues.slice();
  console.log(heatmapAttributes);
  let selectedAttributes = heatmapAttributes.slice();

  function updateLeagueDropdownLabel() {
    const labelEl = document.getElementById("league-dropdown-toggle");
    if (!labelEl) return;
    const span = labelEl.querySelector("span");
    if (!span) return;
    if (selectedLeagues.length === leagues.length)
      span.textContent = "All Leagues";
    else if (selectedLeagues.length === 0) span.textContent = "No Leagues";
    else if (selectedLeagues.length === 1)
      span.textContent = selectedLeagues[0];
    else span.textContent = `${selectedLeagues.length} leagues selected`;
  }

  function announceSelection(msg) {
    const el = document.getElementById("sr-announce");
    if (el) el.textContent = msg;
  }

  function singleSelectLeague(leagueName) {
    selectedLeagues = [leagueName];
    document.querySelectorAll("input.league-checkbox").forEach((cb) => {
      cb.checked = cb.value === leagueName;
    });
    updateLeagueDropdownLabel();
    renderLeagueHeatmap(selectedLeagues);
    rebuildParasolFromSelection();
    announceSelection(leagueName + " only");
    document.getElementById("league-dropdown-menu").style.display = "none";
    updateAxisLabelHighlights();
  }

  function selectAllLeagues() {
    selectedLeagues = leagues.slice();
    document.querySelectorAll("input.league-checkbox").forEach((cb) => {
      cb.checked = true;
    });
    updateLeagueDropdownLabel();
    renderLeagueHeatmap(selectedLeagues);
    rebuildParasolFromSelection();
    announceSelection("All leagues selected");
    updateAxisLabelHighlights();
  }

  function clearAllLeagues() {
    selectedLeagues = [];
    document.querySelectorAll("input.league-checkbox").forEach((cb) => {
      cb.checked = false;
    });
    updateLeagueDropdownLabel();
    renderLeagueHeatmap(selectedLeagues);
    rebuildParasolFromSelection();
    announceSelection("No leagues selected");
    updateAxisLabelHighlights();
  }

  // Inject league checkboxes into the dropdown menu
  const menu = document.getElementById("league-dropdown-menu");
  leagues.forEach((league) => {
    const itemDiv = document.createElement("div");
    itemDiv.className = "flex flex-row gap-2 items-center py-2";
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.className = "checkbox checkbox-xs league-checkbox";
    checkbox.value = league;
    checkbox.checked = selectedLeagues.includes(league);
    checkbox.setAttribute("aria-label", "Select " + league);
    checkbox.id = "lg-" + league.replace(/\s+/g, "-");
    checkbox.addEventListener("click", (e) => e.stopPropagation());
    checkbox.addEventListener("change", function () {
      const value = this.value;
      const isChecked = this.checked;
      if (isChecked) {
        if (!selectedLeagues.includes(value)) selectedLeagues.push(value);
      } else {
        selectedLeagues = selectedLeagues.filter((l) => l !== value);
      }
      updateLeagueDropdownLabel();
      announceSelection(
        selectedLeagues.length === 0
          ? "No leagues selected"
          : selectedLeagues.length === leagues.length
          ? "All leagues selected"
          : selectedLeagues.length === 1
          ? selectedLeagues[0] + " selected"
          : selectedLeagues.length + " leagues selected"
      );
      renderLeagueHeatmap(selectedLeagues);
      rebuildParasolFromSelection();
      updateAxisLabelHighlights();
    });
    const label = document.createElement("span");
    label.className = "league-text";
    label.setAttribute("role", "button");
    label.setAttribute("tabindex", "0");
    label.textContent = league;
    label.style.cursor = "pointer";
    label.addEventListener("click", function (e) {
      e.preventDefault();
      e.stopPropagation();
      singleSelectLeague(league);
    });
    label.addEventListener("keydown", function (e) {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        e.stopPropagation();
        singleSelectLeague(league);
      }
    });
    itemDiv.appendChild(checkbox);
    itemDiv.appendChild(label);
    menu.appendChild(itemDiv);
  });

  // Attach event listeners to Select all / Clear all buttons
  document.getElementById("league-btn-all").onclick = function (e) {
    e.stopPropagation();
    selectAllLeagues();
  };
  document.getElementById("league-btn-clear").onclick = function (e) {
    e.stopPropagation();
    clearAllLeagues();
  };

  // Dropdown toggle logic
  document
    .getElementById("league-dropdown-toggle")
    .addEventListener("click", function (e) {
      e.stopPropagation();
      const menuEl = document.getElementById("league-dropdown-menu");
      const visible = menuEl.style.display === "block";
      menuEl.style.display = visible ? "none" : "block";
    });

  document.addEventListener("click", function () {
    document.getElementById("league-dropdown-menu").style.display = "none";
  });

  const columns = heatmapAttributes.slice();
  let selectedColumns = columns.slice();

  function updateColumnDropdownLabel() {
    const labelEl = document.getElementById("column-visibility-dropdown-label");
    if (!labelEl) return;
    if (selectedColumns.length === columns.length)
      labelEl.textContent = "All Columns";
    else if (selectedColumns.length === 0) labelEl.textContent = "No Columns";
    else if (selectedColumns.length === 1)
      labelEl.textContent =
        attributeTitles[selectedColumns[0]] || selectedColumns[0];
    else labelEl.textContent = `${selectedColumns.length} columns selected`;
  }

  function singleSelectColumn(colName) {
    selectedColumns = [colName];
    document.querySelectorAll("input.column-checkbox").forEach((cb) => {
      cb.checked = cb.value === colName;
    });
    updateColumnDropdownLabel();
    syncAttributesWithColumns();
  }

  function selectAllColumns() {
    selectedColumns = columns.slice();
    document.querySelectorAll("input.column-checkbox").forEach((cb) => {
      cb.checked = true;
    });
    updateColumnDropdownLabel();
    syncAttributesWithColumns();
  }

  function clearAllColumns() {
    selectedColumns = [];
    document.querySelectorAll("input.column-checkbox").forEach((cb) => {
      cb.checked = false;
    });
    updateColumnDropdownLabel();
    syncAttributesWithColumns();
  }

  // Inject column checkboxes into the dropdown menu
  const colMenu = document.getElementById("column-visibility-dropdown-menu");
  let lastType = null;
  columns.forEach((col, idx) => {
    const type = getColumnType(col);
    // Insert a separator when the type changes (except before the first group)
    if (type !== lastType && idx !== 0) {
      const sep = document.createElement("div");
      sep.className = "border-t border-base-300 my-1";
      colMenu.appendChild(sep);
    }
    

    if (type !== lastType) {
      const typeTitle = document.createElement("div");
      typeTitle.className = "dropdown-type-title";
      typeTitle.style.fontWeight = "bold";
      typeTitle.style.color = "#1565c0";
      typeTitle.style.marginTop = idx === 0 ? "0" : "8px";
      typeTitle.style.marginBottom = "2px";
      typeTitle.textContent = type;
      colMenu.appendChild(typeTitle);
    }

    lastType = type;

    const itemDiv = document.createElement("div");
    itemDiv.className = "flex flex-row gap-2 items-center py-2";
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.className = "checkbox checkbox-xs column-checkbox";
    checkbox.value = col;
    checkbox.checked = selectedColumns.includes(col);
    checkbox.setAttribute("aria-label", "Select " + col);
    checkbox.id = "col-" + col.replace(/\s+/g, "-");
    checkbox.addEventListener("click", (e) => e.stopPropagation());
    checkbox.addEventListener("change", function () {
      const value = this.value;
      const isChecked = this.checked;
      if (isChecked) {
        if (!selectedColumns.includes(value)) selectedColumns.push(value);
      } else {
        selectedColumns = selectedColumns.filter((c) => c !== value);
      }
      updateColumnDropdownLabel();
      syncAttributesWithColumns();
    });
    const label = document.createElement("span");
    label.className = "column-text";
    label.setAttribute("role", "button");
    label.setAttribute("tabindex", "0");
    // Show pretty title if available
    label.textContent = attributeTitles[col] || col;
    label.style.cursor = "pointer";
    label.addEventListener("click", function (e) {
      e.preventDefault();
      e.stopPropagation();
      singleSelectColumn(col);
    });
    label.addEventListener("keydown", function (e) {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        e.stopPropagation();
        singleSelectColumn(col);
      }
    });
    itemDiv.appendChild(checkbox);
    itemDiv.appendChild(label);
    colMenu.appendChild(itemDiv);
  });

  // Attach event listeners to Select all / Clear all buttons
  document.getElementById("column-btn-all").onclick = function (e) {
    e.stopPropagation();
    selectAllColumns();
  };
  document.getElementById("column-btn-clear").onclick = function (e) {
    e.stopPropagation();
    clearAllColumns();
  };

  // Dropdown toggle logic
  document
    .getElementById("column-visibility-dropdown-toggle")
    .addEventListener("click", function (e) {
      e.stopPropagation();
      const menuEl = document.getElementById("column-visibility-dropdown-menu");
      const visible = menuEl.style.display === "block";
      menuEl.style.display = visible ? "none" : "block";
    });

  document.addEventListener("click", function () {
    document.getElementById("column-visibility-dropdown-menu").style.display =
      "none";
  });

  // Sync selected columns with heatmap attribute selection
  function syncAttributesWithColumns() {
    selectedAttributes = selectedColumns.slice();
    updateAxisLabelHighlights();
    rebuildParasolFromSelection();
    renderWeightSliders();
    renderLeagueHeatmap(selectedLeagues);
  }

  // When heatmap selection changes, update columns dropdown
  function syncColumnsWithAttributes() {
    selectedColumns = selectedAttributes.slice();
    document.querySelectorAll("input.column-checkbox").forEach((cb) => {
      cb.checked = selectedColumns.includes(cb.value);
    });
    updateColumnDropdownLabel();
  }

  // Patch toggleAttribute to sync columns dropdown
  const origToggleAttribute = toggleAttribute;
  toggleAttribute = function (attr) {
    origToggleAttribute(attr);
    syncColumnsWithAttributes();
  };

  updateColumnDropdownLabel();

  updateLeagueDropdownLabel();

  // #endregion

  // -------------------------------------------
  // #region 6. ATTRIBUTE SELECTION & PCP REBUILD
  // -------------------------------------------
  function updateAxisLabelHighlights() {
    const heatmapDiv = document.getElementById("heatmap");
    if (!heatmapDiv) return;
    const svgTexts = heatmapDiv.querySelectorAll("text");
    svgTexts.forEach((textEl) => {
      const labelText = textEl.textContent.trim();
      const isSelected = selectedAttributes.indexOf(labelText) !== -1;
      const isAttribute = heatmapAttributes.indexOf(labelText) !== -1;
      if (isAttribute) {
        textEl.style.fontWeight = isSelected ? "bold" : "normal";
        textEl.style.fill = isSelected ? "#d32f2f" : "#000";
        textEl.style.cursor = "pointer";
      }
    });
  }
  function setupLabelClickHandling() {
    const heatmapDiv = document.getElementById("heatmap");
    if (!heatmapDiv) return;
    heatmapDiv.on("plotly_click", function (data) {
      const point = data.points[0];
      if (point && point.x && point.y) {
        toggleAttribute(point.x);
        toggleAttribute(point.y);
      }
    });
    const svgTexts = heatmapDiv.querySelectorAll("text");
    svgTexts.forEach((textEl) => {
      const labelText = textEl.textContent.trim();
      const isAttribute = heatmapAttributes.indexOf(labelText) !== -1;
      if (isAttribute) {
        textEl.style.pointerEvents = "auto";
        textEl.style.cursor = "pointer";
        textEl.addEventListener(
          "pointerdown",
          function (e) {
            e.stopPropagation();
            e.preventDefault();
            toggleAttribute(labelText);
          },
          true
        );
      }
    });
  }
  function toggleAttribute(attr) {
    if (!attr) return;
    const i = selectedAttributes.indexOf(attr);
    if (i === -1) selectedAttributes.push(attr);
    else selectedAttributes.splice(i, 1);
    updateAxisLabelHighlights();
    rebuildParasolFromSelection();
    renderWeightSliders();
  }
  function captureGridSelections() {
    selectedTeamNames = [];
    if (gridInstance && gridInstance.getSelectedRows) {
      const selectedRows = gridInstance.getSelectedRows();
      const dataView = gridInstance.getData();
      if (dataView && dataView.getItem) {
        selectedRows.forEach(rowIdx => {
          const item = dataView.getItem(rowIdx);
          if (item && item.team_name) {
            selectedTeamNames.push(item.team_name);
          }
        });
      }
    }
  }

  function restoreGridSelections() {
    if (!gridInstance || selectedTeamNames.length === 0) return;
    
    const dataView = gridInstance.getData();
    if (!dataView || !dataView.getLength) return;
    
    const rowsToSelect = [];
    for (let i = 0; i < dataView.getLength(); i++) {
      const item = dataView.getItem(i);
      if (item && selectedTeamNames.includes(item.team_name)) {
        rowsToSelect.push(i);
      }
    }
    
    if (rowsToSelect.length > 0 && gridInstance.setSelectedRows) {
      gridInstance.setSelectedRows(rowsToSelect);
    }
  }

  function rebuildParasolFromSelection() {
    // Capture current selections before rebuild
    captureGridSelections();
    
    const currentLeagues = Array.isArray(selectedLeagues)
      ? selectedLeagues
      : [];
    if (currentLeagues.length === 0) {
      renderEmptyParasol();
      return;
    }
    const leagueRows = filteredData.filter((d) =>
      currentLeagues.includes(d.league_name)
    );
    const payload = leagueRows.map((d) => {
      const obj = { league_name: d.league_name, team_name: d.team_name };
      selectedAttributes.forEach((a) => {
        obj[a] = d[a];
      });
      if ("weightedScore" in d) obj.weightedScore = d.weightedScore;
      return obj;
    });
    ps = initParasol(payload);
  }
  // #endregion

  // -------------------------------------------
  // #region 7. CLUSTER COUNT & COLOR MODE SELECTORS
  // -------------------------------------------
  const clusterCountSelect = d3.select("#cluster-count-select");
  const clusterOptions = [3, 4, 5, 6, 7, 8, 9, 10, 12, 15];
  clusterCountSelect
    .selectAll("option")
    .data(clusterOptions)
    .enter()
    .append("option")
    .attr("value", (d) => d)
    .text((d) => d + " clusters");
  clusterCountSelect.property("value", currentClusterK);
  clusterCountSelect.on("change", function () {
    const k = +this.value;
    if (!isNaN(k) && k > 1) {
      currentClusterK = k;
      const currentLeagues = Array.isArray(selectedLeagues)
        ? selectedLeagues
        : [];
      if (currentLeagues.length === 0) {
        renderEmptyParasol();
        return;
      }
      const leagueRows = filteredData.filter((d) =>
        currentLeagues.includes(d.league_name)
      );
      const payload = leagueRows.map((d) => {
        const obj = { league_name: d.league_name, team_name: d.team_name };
        selectedAttributes.forEach((a) => {
          obj[a] = d[a];
        });
        return obj;
      });
      ps = initParasol(payload);
    }
  });
  const colorBySelect = d3.select("#color-by-select");
  colorBySelect.property("value", currentColorMode);
  colorBySelect.on("change", function () {
    currentColorMode = this.value;
    applyColoring(ps, currentColorMode, currentParasolData);
  });
  // #endregion

  // -------------------------------------------
  // #region 7.5. CUSTOM TABLE WITH SEARCH & PAGINATION
  // -------------------------------------------
  function renderCustomTable(data) {
    const grid = document.getElementById("grid");
    grid.innerHTML = "";
    if (!data || data.length === 0) return;

    // Table state
    const pageSize = 10;
    let currentPage = 1;
    let filteredRows = data.slice();
    let sortColumn = null;
    let sortDirection = 1;

    const initialCols = ["league_name", "team_name"];

    // Only show selectedColumns, fallback to all if none selected
    function getColumnsToShow() {
      // Show initialCols (league_name, team_name) plus any selectedColumns (no duplicates)
      const cols = initialCols.concat(
        selectedColumns
          ? selectedColumns.filter((c) => !initialCols.includes(c))
          : []
      );
      return cols;
    }

    // Search input
    const searchInput = document.getElementById("datatable-search");
    function filterRows() {
      const query = ((searchInput && searchInput.value) || "").toLowerCase();
      if (!query) {
        filteredRows = data.slice();
      } else {
        filteredRows = data.filter(
          (row) =>
            (row.team_name && row.team_name.toLowerCase().includes(query)) ||
            (row.league_name && row.league_name.toLowerCase().includes(query))
        );
      }
      currentPage = 1;
      renderTable();
      updatePagination();
    }
    if (searchInput) {
      searchInput.oninput = filterRows;
    }

    // Pagination controls
    const prevBtn = document.getElementById("datatable-prev");
    const nextBtn = document.getElementById("datatable-next");
    const pageInfo = document.getElementById("datatable-page-info");

    function updatePagination() {
      const totalPages = Math.ceil(filteredRows.length / pageSize) || 1;
      if (pageInfo)
        pageInfo.textContent = `Page ${currentPage} of ${totalPages}`;
      if (prevBtn) prevBtn.disabled = currentPage <= 1;
      if (nextBtn) nextBtn.disabled = currentPage >= totalPages;
    }
    if (prevBtn) {
      prevBtn.onclick = function () {
        if (currentPage > 1) {
          currentPage--;
          renderTable();
          updatePagination();
        }
      };
    }
    if (nextBtn) {
      nextBtn.onclick = function () {
        const totalPages = Math.ceil(filteredRows.length / pageSize) || 1;
        if (currentPage < totalPages) {
          currentPage++;
          renderTable();
          updatePagination();
        }
      };
    }

    function sortRows() {
      if (!sortColumn) return;
      filteredRows.sort((a, b) => {
        const valA = a[sortColumn];
        const valB = b[sortColumn];
        // Numeric sort if both values are numbers
        if (!isNaN(valA) && !isNaN(valB)) {
          return (valA - valB) * sortDirection;
        }
        // String sort otherwise
        return String(valA).localeCompare(String(valB)) * sortDirection;
      });
    }

    function renderTable() {
      grid.innerHTML = "";
      const table = document.createElement("table");
      table.className =
        "table w-full table-sm border-collapse border border-base-300";

      // Header: Multi-level (columnTypes above, then attributeTitles)
      const columnsToShow = getColumnsToShow();

      // First header row: columnTypes
      const thead = document.createElement("thead");
      const typeRow = document.createElement("tr");
      typeRow.className = "overflow-hidden";
      let lastType = null,
        span = 0;
      let typeCells = [];
      columnsToShow.forEach((col, idx) => {
        const type = getColumnType(col);
        if (type !== lastType && span > 0) {
          // Append previous cell
          const th = document.createElement("th");
          th.colSpan = span;
          th.className = "bg-base-300 text-center border-r border-base-400";
          th.textContent = lastType;
          typeRow.appendChild(th);
          typeCells.push({ type: lastType, span });
          span = 0;
        }
        lastType = type;
        span++;
        // If last column, append cell
        if (idx === columnsToShow.length - 1) {
          const th = document.createElement("th");
          th.colSpan = span;
          th.className = "bg-base-300 text-center border border-base-300";
          th.textContent = lastType;
          typeRow.appendChild(th);
          typeCells.push({ type: lastType, span });
        }
      });
      thead.appendChild(typeRow);

      // Second header row: attributeTitles or raw column name
      const headerRow = document.createElement("tr");
      columnsToShow.forEach((key) => {
        const th = document.createElement("th");
        th.classList.add(
          "bg-base-200",
          "border",
          "border-base-300",
          "text-center"
        );
        // Show pretty title if available
        if (key === "team_name") th.textContent = "Team";
        else if (key === "league_name") th.textContent = "League";
        else th.textContent = attributeTitles[key] || key;
        // Add sort indicator
        if (sortColumn === key) {
          th.textContent += sortDirection === 1 ? " ▲" : " ▼";
        }
        // Add click handler for sorting
        th.style.cursor = "pointer";
        th.addEventListener("click", function () {
          if (sortColumn === key) {
            sortDirection *= -1; // Toggle direction
          } else {
            sortColumn = key;
            sortDirection = 1;
          }
          sortRows();
          renderTable();
          updatePagination();
        });
        headerRow.appendChild(th);
      });
      thead.appendChild(headerRow);
      table.appendChild(thead);

      // Body
      const tbody = document.createElement("tbody");
      const startIdx = (currentPage - 1) * pageSize;
      const endIdx = Math.min(startIdx + pageSize, filteredRows.length);
      for (let i = startIdx; i < endIdx; i++) {
        const row = filteredRows[i];
        const tr = document.createElement("tr");
        columnsToShow.forEach((key) => {
          const td = document.createElement("td");
          if (key == "team_name" || key == "league_name")
            td.className = "whitespace-nowrap border border-base-300";
          else td.className = "text-center border border-base-300";
          td.textContent = row[key];
          tr.appendChild(td);
        });
        tr.addEventListener("mouseenter", function () {
          if (ps && typeof ps.highlight === "function") {
            ps.highlight([row]);
          }
        });
        tr.addEventListener("mouseleave", function () {
          if (ps && typeof ps.highlight === "function") {
            // Highlight all rows when none is hovered
            ps.highlight([]);
            // Remove faded class from the foreground canvas
            const fgCanvas = document.querySelector(
              ".parcoords canvas.foreground"
            );
            if (fgCanvas) fgCanvas.classList.remove("faded");
          }
        });
        tbody.appendChild(tr);
      }
      table.appendChild(tbody);
      grid.appendChild(table);
    }

    // Initial render
    filterRows();
    updatePagination();

    // Re-render table when columns change
    if (!window._customTableColumnListenerAdded) {
      window._customTableColumnListenerAdded = true;
      let lastColumns = selectedColumns ? selectedColumns.slice() : [];
      setInterval(() => {
        const currentColumns = selectedColumns ? selectedColumns.slice() : [];
        if (
          currentColumns.length !== lastColumns.length ||
          currentColumns.some((col, i) => col !== lastColumns[i])
        ) {
          sortRows();
          renderTable();
          updatePagination();
          lastColumns = currentColumns.slice();
        }
      }, 300);
      // Also patch syncAttributesWithColumns to re-render table
      const origSyncAttributesWithColumns = window.syncAttributesWithColumns;
      window.syncAttributesWithColumns = function () {
        origSyncAttributesWithColumns();
        sortRows();
        renderTable();
        updatePagination();
      };
    }
  }
  // #endregion

  // -------------------------------------------
  // #region 8. INITIAL RENDERS
  // -------------------------------------------
  const initialParasolPayload = filteredData.map((d) => ({
    league_name: d.league_name,
    team_name: d.team_name,
  }));
  let ps = initParasol(initialParasolPayload);
  renderLeagueHeatmap(selectedLeagues);
  renderWeightSliders();
  renderCustomTable(filteredData);

  // #endregion
});
