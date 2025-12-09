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

  // -------------------------------------------
  // 2. PARASOL (PARALLEL COORDINATES) LOGIC
  // -------------------------------------------
  const firstColumn = "league_name";
  const clusterVariables = Object.keys(filteredData[0]).filter(
    (key) =>
      !ignoreKeys.has(key) &&
      filteredData.some(
        (d) =>
          d[key] !== null &&
          d[key] !== undefined &&
          d[key] !== "" &&
          !isNaN(+d[key])
      )
  );
  const dimensionsOrdered = [
    firstColumn,
    ...clusterVariables.filter((v) => v !== firstColumn),
  ];
  let currentColorMode = "league";
  let currentClusterK = 12;
  let currentParasolData = null;
  // current alpha/opacity for PCP lines
  let currentAlpha = 0.1;
  // current smoothness value (0-1)
  let currentSmoothness = 0;
  // current bundling strength (0-1)
  let currentBundling = 0;

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
        .range(d3.schemeTableau10);
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
    document.querySelector("#grid").innerHTML = "";

    const psBase = Parasol(dataForParasol)(".parcoords")
      .attachGrid({ container: "#grid" })
      .linked()
      .alpha(currentAlpha)
      .reorderable();

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
    const attrValues = heatmapAttributes.map((attr) =>
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
    const matrix = heatmapAttributes.map((a, i) =>
      heatmapAttributes.map((b, j) =>
        i === j ? 1 : pearson(attrValues[i], attrValues[j])
      )
    );
    const clamped = matrix.map((row) =>
      row.map((v) => Math.max(-1, Math.min(1, v)))
    );
    const yAttrs = heatmapAttributes.slice().reverse();
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
          x: heatmapAttributes,
          y: yAttrs,
          type: "heatmap",
          colorscale: "RdBu",
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
        width: 800,
        height: 480,
        margin: { l: 60, r: 120, t: 20, b: 160 },
        xaxis: { automargin: true, tickangle: -30, tickfont: { size: 10 } },
        yaxis: { automargin: true, tickfont: { size: 10 } },
      }
    );
    setupLabelClickHandling();
  }
  // #endregion

  // -------------------------------------------
  // #region 5. LEAGUE DROPDOWN & SELECTION LOGIC
  // -------------------------------------------
  const leagues = Array.from(new Set(data.map((d) => d.league_name))).sort();
  let selectedLeagues = leagues.slice();
  let selectedAttributes = [];

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
    checkbox.className = "checkbox checkbox-xs";
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
  let selectedColumns = [];

  function updateColumnDropdownLabel() {
    const labelEl = document.getElementById("column-visibility-dropdown-label");
    if (!labelEl) return;
    if (selectedColumns.length === columns.length)
      labelEl.textContent = "All Columns";
    else if (selectedColumns.length === 0) labelEl.textContent = "No Columns";
    else if (selectedColumns.length === 1)
      labelEl.textContent = selectedColumns[0];
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
  columns.forEach((col) => {
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
    label.textContent = col;
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
  function rebuildParasolFromSelection() {
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
  // #region 8. INITIAL RENDERS
  // -------------------------------------------
  const initialParasolPayload = filteredData.map((d) => ({
    league_name: d.league_name,
    team_name: d.team_name,
  }));
  let ps = initParasol(initialParasolPayload);
  renderLeagueHeatmap(selectedLeagues);
  renderWeightSliders();
  // #endregion
});
