// -------------------------------------------
// -------------------------------------------
// #region 0. UPDATE ALL GRAPHS & TABLES
// -------------------------------------------

// #endregion
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
    league_name: "League",
    team_name: "Team",
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
    weightedScore: "Weighted Score",
    cluster: "Cluster",
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

  let currentClusterK = 0;
  // current alpha/opacity for PCP lines
  let currentAlpha = 0.1;
  // current smoothness value (0-1)
  let currentSmoothness = 0;
  // current bundling strength (0-1)
  let currentBundling = 0;

  const leagues = Array.from(new Set(data.map((d) => d.league_name))).sort();
  let selectedLeagues = leagues.slice();

  let selectedAttributes = [];

  let ps = null;

  // Map columns to their types
  function getColumnType(col) {
    if (col === "team_name" || col === "league_name") return "Team";
    if (col == "weightedScore") return "Score";
    if (col == "cluster") return "Cluster";
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

  const weightedAttributes = Object.values(attributeGroups).flat();
  let attributeWeights = {};
  weightedAttributes.forEach((a) => (attributeWeights[a] = 1));

  function updateAll() {
    if (selectedLeagues.length == 0) {
      document.getElementById("show-league-message").classList.remove("hidden");
      document.getElementById("graphs").style.display = "none";
      return;
    } else {
      document.getElementById("show-league-message").classList.add("hidden");
      document.getElementById("graphs").style.display = "";
    }

    const smoothnessSlider = document.getElementById("curve-smoothness-div");
    const bundlingSlider = document.getElementById("bundling-strength-div");
    const clusterDiv = document.getElementById("cluster-div");

    if (currentClusterK > 0) {
      clusterDiv.style.display = "none";
      if (smoothnessSlider) smoothnessSlider.style.display = "";
      if (bundlingSlider) bundlingSlider.style.display = "";
    } else {
      clusterDiv.style.display = "";
      if (smoothnessSlider) smoothnessSlider.style.display = "none";
      if (bundlingSlider) bundlingSlider.style.display = "none";
    }

    // PCP
    const currentLeagues = Array.isArray(selectedLeagues)
      ? selectedLeagues
      : [];
    if (currentLeagues.length === 0) {
      renderEmptyParasol();
    } else {
      const leagueRows = filteredData.filter((d) =>
        currentLeagues.includes(d.league_name)
      );
      const payload = leagueRows.map((d) => {
        const obj = { league_name: d.league_name, team_name: d.team_name };
        selectedAttributes.forEach((a) => {
          obj[a] = d[a];
        });
        if ("weightedScore" in d) obj.weightedScore = d.weightedScore;
        // Don't include old cluster values - let Parasol create fresh ones
        // if ("cluster" in d) obj.cluster = d.cluster;
        return obj;
      });
      initParasol(payload);
    }
    // Heatmap
    renderLeagueHeatmap(selectedLeagues);
    // Weight sliders
    renderWeightSliders();
    // Table
    const tableRows =
      selectedLeagues.length === 0
        ? []
        : filteredData.filter((d) => selectedLeagues.includes(d.league_name));
    renderCustomTable(tableRows);
  }

  //#endregion

  // -------------------------------------------
  // #region 2. PARASOL (PARALLEL COORDINATES) LOGIC
  // -------------------------------------------

  function computeWeightedScores(data) {
    data.forEach((d) => {
      let sum = 0,
        totalW = 0;
      for (const [attr, w] of Object.entries(attributeWeights)) {
        // Only include attributes that are currently selected
        if (
          selectedAttributes.includes(attr) &&
          d[attr] !== undefined &&
          !isNaN(+d[attr])
        ) {
          sum += +d[attr] * w;
          totalW += w;
        }
      }
      d.weightedScore = totalW > 0 ? (sum / totalW).toFixed(2) : "0.00";
    });
    return data;
  }

  function applyColoring(psInstance, dataForParasol) {
    if (!psInstance) return;
    const customColors = [
      // Okabe-Ito palette
      "#56b4e9", // Sky Blue
      "#d55e00", // Vermillion
      "#cc79a7", // Pink
      "#009e73", // Green
      "#f0e442", // Yellow
      "#e69f00", // Orange
      "#0072b2", // Blue

      // Additional colors
      "#000000", // Black
      "#996636ff", // Brown
      "#666666", // Gray
      "#808000", // Olive

      // Extra color if 12 clusters selected
      "#cccccc" // Light Gray
    ];
    
    // If clusters are enabled (k > 0), color by cluster, else by league
    if (currentClusterK > 0) {
      const data = dataForParasol || psInstance.state.data;
      const clusterPalette = d3.scaleOrdinal().domain(data).range(customColors);
      psInstance.color((d) => clusterPalette(d.cluster));
    } else {
      // Create explicit color map based on selection order
      const colorMap = {};
      selectedLeagues.forEach((league, idx) => {
        colorMap[league] = customColors[idx % customColors.length];
      });
      psInstance.color((d) => colorMap[d.league_name] || customColors[0]);
    }
  }

  function reapplyOrdinalLabels() {
    setTimeout(() => {
      const parcoordsSvg = d3.select(".parcoords svg");
      if (!parcoordsSvg.empty()) {
        parcoordsSvg.selectAll(".dimension").each(function () {
          const dimGroup = d3.select(this);
          // Get the raw attribute key from the axis (not the pretty label)
          let axisKey = dimGroup.attr("data-dimension");
          // Fallback: try to map from label text to key
          if (!axisKey) {
            const axisTitle = dimGroup.select(".label").text();
            axisKey =
              Object.keys(attributeTitles).find(
                (k) => attributeTitles[k] === axisTitle
              ) || axisTitle;
          }
          // Set pretty axis label if possible
          if (attributeTitles[axisKey]) {
            dimGroup.select(".label").text(attributeTitles[axisKey]);
          }
          // For ordinal axes, relabel ticks
          if (ordinalLabels[axisKey]) {
            dimGroup.selectAll(".tick").each(function () {
              const tick = d3.select(this);
              const textEl = tick.select("text");
              const numValue = parseFloat(textEl.text());
              if (!isNaN(numValue)) {
                const mapped = ordinalLabels[axisKey][numValue];
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

    // Clear old cluster assignments from filteredData when cluster count changes
    filteredData.forEach(d => {
      if (currentClusterK === 0) {
        delete d.cluster;
      }
    });

    // Determine which base columns to include based on number of leagues
    const uniqueLeagues = Array.from(
      new Set(dataForParasol.map((d) => d.league_name))
    );
    const baseCols =
      uniqueLeagues.length === 1
        ? ["team_name"] // Only show team names when one league
        : ["league_name", "team_name"]; // Show both when multiple leagues

    const orderedCols = baseCols.concat(
      selectedAttributes.filter(
        (attr) =>
          !baseCols.includes(attr) &&
          !["league_name", "team_name"].includes(attr) &&
          dataForParasol.some((d) => d.hasOwnProperty(attr))
      )
    );

    // Reorder each row to match orderedCols (only include columns in orderedCols)
    const reorderedData = dataForParasol.map((row) => {
      const newRow = {};
      orderedCols.forEach((col) => {
        newRow[col] = row[col];
      });
      // Include cluster and weightedScore if they exist
      if (row.cluster !== undefined) newRow.cluster = row.cluster;
      if (row.weightedScore !== undefined) newRow.weightedScore = row.weightedScore;
      return newRow;
    });

    // Map axis labels to attributeTitles for Parasol (force mapping after render)
    const axisLabels = {};
    orderedCols.forEach((col) => {
      if (
        col !== "league_name" &&
        col !== "team_name" &&
        attributeTitles[col]
      ) {
        axisLabels[col] = attributeTitles[col];
      }
    });

    const psBase = Parasol(reorderedData)(".parcoords")
      .reorderable()
      .alpha(currentAlpha);

    const keys = reorderedData.length ? Object.keys(reorderedData[0]) : [];
    const numericVars = keys.filter(
      (k) =>
        k !== "league_name" &&
        k !== "team_name" &&
        reorderedData.some((d) => !isNaN(+d[k]))
    );
    let psLocal = psBase;

    if (numericVars.length > 0 && currentClusterK > 0) {
      psLocal = psBase.cluster({
        k: currentClusterK,
        vars: numericVars,
        hidden: false,
      });
    }

    psLocal = psLocal.render();
    ps = psLocal;
    
    // Apply colors based on selection order
    const customColors = [
      "#56b4e9", // Sky Blue
      "#e69f00", // Orange
      "#009e73", // Green
      "#f0e442", // Yellow
      "#0072b2", // Blue
      "#d55e00", // Vermillion
      "#cc79a7", // Pink
      "#000000", // Black
      "#666666", // Gray
      "#cccccc", // Light Gray
      "#808000", // Olive
    ];
    
    if (currentClusterK > 0) {
      const clusterPalette = d3.scaleOrdinal().range(customColors);
      psLocal.color((d) => clusterPalette(d.cluster)).render();
    } else {
      // Create explicit color map based on selection order
      const colorMap = {};
      selectedLeagues.forEach((league, idx) => {
        colorMap[league] = customColors[idx % customColors.length];
      });
      psLocal.color((d) => colorMap[d.league_name] || customColors[0]).render();
    }
    
    // Sync cluster assignments back to filteredData for table display
    if (currentClusterK > 0 && psLocal.state && psLocal.state.data) {
      psLocal.state.data.forEach((clusteredRow) => {
        const match = filteredData.find(
          (d) => d.league_name === clusteredRow.league_name && d.team_name === clusteredRow.team_name
        );
        if (match && clusteredRow.cluster !== undefined) {
          match.cluster = clusteredRow.cluster;
        }
        
        // ALSO sync to reorderedData for brush filtering
        const reorderedMatch = reorderedData.find(
          (d) => d.league_name === clusteredRow.league_name && d.team_name === clusteredRow.team_name
        );
        if (reorderedMatch && clusteredRow.cluster !== undefined) {
          reorderedMatch.cluster = clusteredRow.cluster;
        }
      });
    }

    // Force axis label mapping after render (for libraries that require post-render relabel)
    if (Object.keys(axisLabels).length > 0 && psLocal.axisLabels) {
      psLocal.axisLabels(axisLabels);
      // Also try to update SVG labels directly if needed
      setTimeout(() => {
        const svg = document.querySelector(".parcoords svg");
        if (svg) {
          svg.querySelectorAll(".dimension .label").forEach((labelEl) => {
            const raw = labelEl.textContent;
            if (axisLabels[raw]) {
              labelEl.textContent = axisLabels[raw];
            }
          });
        }
      }, 50);
    }

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

    if (selectedLeagues.length === 1) {
      psLocal.hideAxes(["league_name"]);
      psLocal.showAxes(["team_name"]);
      psLocal.alpha(0.5).render();
    } else {
      psLocal.showAxes(["league_name"]);
      psLocal.hideAxes(["team_name"]);
    }

    setTimeout(reapplyOrdinalLabels, 10);
    
    // Apply coloring AFTER all render() calls to prevent colors from being reset
    applyColoring(psLocal, reorderedData);
    psLocal.render();

    // Enable brushing
    if (typeof psLocal.brushable === 'function') {
      psLocal.brushable();
    }

    // Set up MutationObserver to watch for brush changes and update table
    setTimeout(() => {
      const parcoords = document.querySelector('.parcoords');
      if (!parcoords) return;
      
      let updateTimeout = null;
      const cachedBrushData = {};
      
      const updateTableFromBrush = () => {
        const brushFilters = Object.values(cachedBrushData).filter(b => b.active);
        
        if (brushFilters.length > 0 && ps && ps.charts && ps.charts[0]) {
          const dimensions = ps.charts[0].state.dimensions;
          if (!dimensions) return;
          
          const filteredData = reorderedData.filter(row => {
            return brushFilters.every(filter => {
              const attrValue = row[filter.attribute];
              const dim = dimensions[filter.attribute];
              
              if (dim && dim.yscale) {
                const pixelPos = dim.yscale(attrValue);
                const match = pixelPos >= filter.yExtent[0] && pixelPos <= filter.yExtent[1];
                return match;
              }
              return true;
            });
          });
          
          renderCustomTable(filteredData);
        } else {
          renderCustomTable(reorderedData);
        }
      };
      
      const observer = new MutationObserver((mutations) => {
        mutations.forEach(mutation => {
          const target = mutation.target;
          
          if (!target.classList || !target.classList.contains('selection')) {
            return;
          }
          
          const dimElement = target.closest('.dimension');
          if (dimElement) {
            const label = dimElement.querySelector('.label');
            const dimLabel = label ? label.textContent.trim() : '';
            let attrKey = Object.keys(attributeTitles).find(
              k => attributeTitles[k] === dimLabel
            ) || dimLabel;
            
            const isActive = target.style.display !== 'none';
            
            if (isActive) {
              const y = parseFloat(target.getAttribute('y'));
              const height = parseFloat(target.getAttribute('height'));
              
              if (!isNaN(y) && !isNaN(height)) {
                cachedBrushData[attrKey] = {
                  attribute: attrKey,
                  yExtent: [y, y + height],
                  active: true
                };
              }
            } else {
              if (cachedBrushData[attrKey]) {
                cachedBrushData[attrKey].active = false;
              }
            }
          }
        });
        
        if (updateTimeout) clearTimeout(updateTimeout);
        updateTimeout = setTimeout(updateTableFromBrush, 0);
      });
      
      observer.observe(parcoords, {
        attributes: true,
        attributeFilter: ['y', 'height', 'style'],
        subtree: true,
        childList: true
      });
    }, 300);

    // Sliders
    d3.select("#bundling").on("input", function () {
      currentBundling = +this.value / 100;
      psLocal
        .bundlingStrength(currentBundling)
        .bundleDimension("cluster")
        .render();
      applyColoring(psLocal, reorderedData);
      psLocal.render();
      reapplyOrdinalLabels();
      restoreBrushes();
    });
    d3.select("#smoothness").on("input", function () {
      currentSmoothness = +this.value / 100;
      psLocal.smoothness(currentSmoothness).render();
      applyColoring(psLocal, reorderedData);
      psLocal.render();
      reapplyOrdinalLabels();
      restoreBrushes();
    });
    d3.select("#alpha").on("input", function () {
      currentAlpha = +this.value / 100;
      psLocal.alpha(currentAlpha).render();
      applyColoring(psLocal, reorderedData);
      psLocal.render();
      reapplyOrdinalLabels();
      restoreBrushes();
    });
    
    // Function to restore brush extents after render
    function restoreBrushes() {
      if (!cachedBrushData || Object.keys(cachedBrushData).length === 0) return;
      
      setTimeout(() => {
        Object.entries(cachedBrushData).forEach(([attrKey, brushData]) => {
          if (!brushData.active) return;
          
          // Find the dimension element for this attribute
          d3.selectAll('.parcoords .dimension').each(function() {
            const dimGroup = d3.select(this);
            const label = dimGroup.select('.label');
            const dimLabel = label ? label.text() : '';
            const currentAttrKey = Object.keys(attributeTitles).find(
              k => attributeTitles[k] === dimLabel
            ) || dimLabel;
            
            if (currentAttrKey === attrKey) {
              // Restore the brush extent
              const brushGroup = dimGroup.select('.brush');
              if (!brushGroup.empty() && brushGroup.node().__brush) {
                const brush = brushGroup.node().__brush;
                
                // Set the extent - this should trigger Parasol's brush handler
                const extent = [[0, brushData.yExtent[0]], [0, brushData.yExtent[1]]];
                brushGroup.call(brush.move, extent);
              }
            }
          });
        });
      }, 100);
    }

    return psLocal;
  }

  function renderEmptyParasol() {
    document.querySelector(".parcoords").innerHTML = "";
    document.querySelector("#grid").innerHTML = "";
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
        .attr("class", "fieldset-legend font-medium divider ")
        .text(groupName);
      attrsInGroup.forEach((attr) => {
        const row = panel
          .append("div")
          .attr("class", "flex flex-row gap-1 items-center");
        row
          .append("span")
          .attr("class", "fieldset-legend text-sm w-64")
          .text(attributeTitles[attr] ?? attr);
        row
          .append("input")
          .attr("type", "range")
          .attr("min", 0)
          .attr("max", 2)
          .attr("step", 0.1)
          .attr("value", attributeWeights[attr])
          .attr("class", "range range-xs ")
          .on("input", function () {
            attributeWeights[attr] = +this.value;
          });
      });
    });
    panel
      .append("button")
      .attr("id", "apply-weights")
      .text("Apply Weights")
      .attr("class", "btn btn-primary btn-outline")
      .on("click", function () {
        computeWeightedScores(filteredData);
        updateAll();
      });
  }
  // #endregion

  // -------------------------------------------
  // #region 4. HEATMAP LOGIC (Plotly)
  // -------------------------------------------

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

    // Use only selectedAttributes for the heatmap
    const attrs = heatmapAttributes.slice();
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

    // Compute correlation matrix for all columns
    const matrix = attrs.map((a, i) =>
      attrs.map((b, j) => (i === j ? 1 : pearson(attrValues[i], attrValues[j])))
    );
    const clamped = matrix.map((row) =>
      row.map((v) => Math.max(-1, Math.min(1, v)))
    );
    const yAttrs = attrs.slice().reverse();
    const zReordered = clamped.slice().reverse();
    const textReordered = zReordered.map((row) => row.map((v) => v.toFixed(2)));

    // Use pretty attribute titles for axis labels
    const xLabels = attrs.map((a) => attributeTitles[a] || a);
    const yLabels = yAttrs.map((a) => attributeTitles[a] || a);

    Plotly.newPlot(
      "heatmap",
      [
        {
          z: zReordered,
          x: xLabels,
          y: yLabels,
          type: "heatmap",
          colorscale: [
            [0, "#7b3294"], // Purple (negative)
            [0.5, "#f7f7f7"], // White (neutral)
            [1, "#e66101"],
          ],
          zmin: -1,
          zmax: 1,
          showscale: true,
          colorbar: { tickvals: [-1, -0.5, 0, 0.5, 1] },
          text: textReordered,
          texttemplate: "%{text}",
          hovertemplate: "<b>%{x}</b> vs <b>%{y}</b><br>Correlation: %{text}<extra></extra>",
        },
      ],
      {
        width: null,
        height: "100%",
        autosize: true,
        margin: { r: 200, t: 20, b: 150 },
        xaxis: { automargin: true, tickfont: { size: 9 }, tickangle: -30 },
        yaxis: { automargin: true, tickfont: { size: 9 } },
      },
      { responsive: true, displayModeBar: false }
    );

    setupLabelClickHandling();
    updateAxisLabelHighlights();
  }
  // #endregion

  // -------------------------------------------
  // #region 5. DROPDOWNS & SELECTION LOGIC
  // -------------------------------------------

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
    updateAll();
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
    updateAll();
    announceSelection("All leagues selected");
    updateAxisLabelHighlights();
  }

  function clearAllLeagues() {
    selectedLeagues = [];
    document.querySelectorAll("input.league-checkbox").forEach((cb) => {
      cb.checked = false;
    });
    updateLeagueDropdownLabel();
    updateAll();
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
      updateAll();
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

  function updateColumnDropdownLabel() {
    const labelEl = document.getElementById("column-visibility-dropdown-label");
    if (!labelEl) return;
    if (selectedAttributes.length === heatmapAttributes.length)
      labelEl.textContent = "All Columns";
    else if (selectedAttributes.length === 0)
      labelEl.textContent = "No Columns";
    else if (selectedAttributes.length === 1)
      labelEl.textContent =
        attributeTitles[selectedAttributes[0]] || selectedAttributes[0];
    else labelEl.textContent = `${selectedAttributes.length} columns selected`;
  }

  function singleSelectColumn(colName) {
    selectedAttributes = [colName];
    document.querySelectorAll("input.column-checkbox").forEach((cb) => {
      cb.checked = cb.value === colName;
    });
    updateColumnDropdownLabel();
    syncAttributesWithColumns();
    updateAll();
  }

  function selectAllColumns() {
    selectedAttributes = [];
    document.querySelectorAll("input.column-checkbox").forEach((cb) => {
      cb.checked = true;
      if (!selectedAttributes.includes(cb.value)) {
        selectedAttributes.push(cb.value);
      }
    });
    updateColumnDropdownLabel();
    syncAttributesWithColumns();
  }

  function clearAllColumns() {
    selectedAttributes = [];
    document.querySelectorAll("input.column-checkbox").forEach((cb) => {
      cb.checked = false;
    });
    updateColumnDropdownLabel();
    syncAttributesWithColumns();
    updateAll();
  }

  // Inject column checkboxes into the dropdown menu
  const colMenu = document.getElementById("column-visibility-dropdown-menu");
  let lastType = null;
  heatmapAttributes.forEach((col, idx) => {
    const type = getColumnType(col);

    if (type !== lastType) {
      const typeTitle = document.createElement("div");
      typeTitle.className = "divider fieldset-legend font-medium";
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
    checkbox.checked = selectedAttributes.includes(col);
    checkbox.setAttribute("aria-label", "Select " + col);
    checkbox.id = "col-" + col.replace(/\s+/g, "-");
    checkbox.addEventListener("click", (e) => e.stopPropagation());
    checkbox.addEventListener("change", function () {
      const value = this.value;
      const isChecked = this.checked;
      if (isChecked) {
        if (!selectedAttributes.includes(value)) selectedAttributes.push(value);
      } else {
        selectedAttributes = selectedAttributes.filter((c) => c !== value);
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
    updateAxisLabelHighlights();
    updateAll();
  }

  // When heatmap selection changes, update columns dropdown
  function syncColumnsWithAttributes() {
    selectedAttributes = selectedAttributes.slice();
    document.querySelectorAll("input.column-checkbox").forEach((cb) => {
      cb.checked = selectedAttributes.includes(cb.value);
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
      const heatmapAttr = Object.keys(attributeTitles).find(
        (key) => attributeTitles[key] === labelText
      );
      const isSelected = selectedAttributes.indexOf(heatmapAttr) !== -1;
      const isAttribute = heatmapAttributes.indexOf(heatmapAttr) !== -1;
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
        // Convert display labels back to attribute keys
        const attrX =
          Object.keys(attributeTitles).find(
            (key) => attributeTitles[key] === point.x
          ) || point.x;
        const attrY =
          Object.keys(attributeTitles).find(
            (key) => attributeTitles[key] === point.y
          ) || point.y;
        toggleAttribute(attrX);
        toggleAttribute(attrY);
      }
    });
    const svgTexts = heatmapDiv.querySelectorAll("text");
    svgTexts.forEach((textEl) => {
      const labelText = textEl.textContent.trim();
      const heatmapAttr = Object.keys(attributeTitles).find(
        (key) => attributeTitles[key] === labelText
      );
      const isAttribute = heatmapAttributes.indexOf(heatmapAttr) !== -1;
      if (isAttribute) {
        textEl.style.pointerEvents = "auto";
        textEl.style.cursor = "pointer";
        textEl.addEventListener(
          "pointerdown",
          function (e) {
            e.stopPropagation();
            e.preventDefault();
            toggleAttribute(heatmapAttr);
          },
          true
        );
      }
    });
    updateAxisLabelHighlights();
  }
  function toggleAttribute(attr) {
    if (!attr) return;
    const i = selectedAttributes.indexOf(attr);
    if (i === -1) selectedAttributes.push(attr);
    else selectedAttributes.splice(i, 1);
    updateAxisLabelHighlights();
    updateAll();
  }

  const clusterCountSelect = d3.select("#cluster-count-select");
  const clusterOptions = [0, 3, 4, 5, 6, 7, 8, 9, 10, 12];
  // Clear and append options manually to ensure 0 is always present
  clusterCountSelect.html("");
  clusterOptions.forEach((d) => {
    const opt = document.createElement("option");
    opt.value = d;
    opt.textContent = d === 0 ? "No clusters" : d + " clusters";
    if (d === currentClusterK) opt.selected = true;
    clusterCountSelect.node().appendChild(opt);
  });
  clusterCountSelect.on("change", function () {
    const k = +this.value;
    if (!isNaN(k)) {
      currentClusterK = k;
      updateAll();
    }
  });

  // #endregion

  // Selection state
  let selectedRows = new Set();

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

    // Only show selectedAttributes, fallback to all if none selected
    function getColumnsToShow() {
      // Show initialCols (league_name, team_name) plus any selectedAttributes (no duplicates)
      let cols = initialCols.concat(
        selectedAttributes
          ? selectedAttributes.filter((c) => !initialCols.includes(c))
          : []
      );
      // If any row has cluster, add it before weightedScore
      if (data && data.some((row) => row.hasOwnProperty("cluster"))) {
        if (!cols.includes("cluster")) cols.push("cluster");
      }
      // If any row has weightedScore, add it as the last column
      if (data && data.some((row) => row.hasOwnProperty("weightedScore"))) {
        if (!cols.includes("weightedScore")) cols.push("weightedScore");
      }
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
        // For ordinal columns, sort by mapped numeric value
        if (ordinalMappings[sortColumn]) {
          return (valA - valB) * sortDirection;
        }
        // Numeric sort if both values are numbers
        if (!isNaN(valA) && !isNaN(valB)) {
          return (valA - valB) * sortDirection;
        }
        // String sort otherwise
        return String(valA).localeCompare(String(valB)) * sortDirection;
      });
    }

    // Helper to get unique row id (team_name + league_name)
    function getRowId(row) {
      return row.league_name + "||" + row.team_name;
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

      let selectionTh = document.createElement("th");
      selectionTh.rowSpan = 1;
      selectionTh.className = "bg-base-300 text-center border border-base-300";
      selectionTh.textContent = ""; // No type for selection column
      typeRow.appendChild(selectionTh);

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
        span++;
        // If this is the last column, append its type cell
        if (idx === columnsToShow.length - 1 && span > 0) {
          const th = document.createElement("th");
          th.colSpan = span;
          th.className = "bg-base-300 text-center border border-base-300";
          th.textContent = type;
          typeRow.appendChild(th);
          typeCells.push({ type: type, span });
        }
        lastType = type;
      });
      thead.appendChild(typeRow);

      // Second header row: attributeTitles or raw column name
      const headerRow = document.createElement("tr");
      // Selection column header with "select all" checkbox
      const selectTh2 = document.createElement("th");
      selectTh2.className = "bg-base-200 border border-base-300 text-center";
      const selectAllCheckbox = document.createElement("input");
      selectAllCheckbox.type = "checkbox";
      selectAllCheckbox.className = "checkbox checkbox-xs";
      selectAllCheckbox.title = "Select/Deselect All";
      
      // Check if all currently visible rows are selected
      const allSelected = filteredRows.every(row => selectedRows.has(getRowId(row)));
      selectAllCheckbox.checked = allSelected && filteredRows.length > 0;
      
      selectAllCheckbox.addEventListener("change", function() {
        if (this.checked) {
          // Select all visible rows
          filteredRows.forEach(row => {
            selectedRows.add(getRowId(row));
          });
        } else {
          // Deselect all visible rows
          filteredRows.forEach(row => {
            selectedRows.delete(getRowId(row));
          });
        }
        renderTable();
        updatePagination();
        
        // Update PCP highlighting
        if (ps && typeof ps.highlight === "function") {
          const selected = data.filter((r) =>
            selectedRows.has(getRowId(r))
          );
          if (selected.length > 0) {
            ps.highlight(selected);
          } else {
            ps.unhighlight(data);
          }
        }
      });
      
      selectTh2.appendChild(selectAllCheckbox);
      headerRow.appendChild(selectTh2);

      columnsToShow.forEach((key) => {
        const th = document.createElement("th");
        th.classList.add(
          "bg-base-200",
          "border",
          "border-base-300",
          "text-center"
        );
        // Show pretty title if available
        th.textContent = attributeTitles[key] || key;
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
        
        // Add hover effect
        tr.addEventListener("mouseenter", function() {
          if (!selectedRows.has(getRowId(row))) {
            tr.classList.add("hover:bg-base-200");
            tr.style.backgroundColor = "#f3f4f6";
          }
          // Highlight the corresponding line in PCP along with selected rows
          if (ps && typeof ps.highlight === "function") {
            // Find ALL selected rows from the full dataset, not just filteredRows
            const selected = data.filter((r) =>
              selectedRows.has(getRowId(r))
            );
            // Highlight both the hovered row and any selected rows
            const toHighlight = [...selected];
            if (!selectedRows.has(getRowId(row))) {
              toHighlight.push(row);
            }
            ps.highlight(toHighlight);
          }
        });
        tr.addEventListener("mouseleave", function() {
          if (!selectedRows.has(getRowId(row))) {
            tr.classList.remove("hover:bg-base-200");
            tr.style.backgroundColor = "";
          }
          // Restore highlighting to selected rows or clear if none selected
          if (ps && typeof ps.unhighlight === "function") {
            // Find ALL selected rows from the full dataset, not just filteredRows
            const selected = data.filter((r) =>
              selectedRows.has(getRowId(r))
            );
            if (selected.length > 0) {
              ps.highlight(selected);
            } else {
              // Clear all highlighting - unhighlight all rows
              ps.unhighlight(data);
            }
          }
        });
        
        // Selection checkbox
        const tdSelect = document.createElement("td");
        tdSelect.className = "text-center border border-base-300";
        const rowId = getRowId(row);
        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.className = "checkbox checkbox-xs";
        checkbox.checked = selectedRows.has(rowId);
        checkbox.addEventListener("change", function () {
          if (this.checked) {
            selectedRows.add(rowId);
            tr.classList.add("bg-base-200");
          } else {
            tr.classList.remove("bg-base-200");
            selectedRows.delete(rowId);
            ps.unhighlight([row]);
          }
          // Highlight all selected rows in Parasol
          if (ps && typeof ps.highlight === "function") {
            // Find ALL selected rows from the full dataset, not just filteredRows
            const selected = data.filter((r) =>
              selectedRows.has(getRowId(r))
            );
            if (selected.length == 0) {
              const canvas = document.querySelector(".foreground");
              if (canvas) {
                canvas.classList.remove("faded");
              }
            } else ps.highlight(selected);
          }
        });
        tdSelect.appendChild(checkbox);
        tr.appendChild(tdSelect);

        columnsToShow.forEach((key) => {
          const td = document.createElement("td");
          if (key == "team_name" || key == "league_name")
            td.className = "whitespace-nowrap border border-base-300";
          else td.className = "text-center border border-base-300";
          // For ordinal columns, show label if available
          if (ordinalMappings[key] && row[key + "_label"]) {
            td.textContent = row[key + "_label"];
          } else if (key === "cluster" && row[key] !== undefined) {
            td.textContent = parseInt(row[key]) + 0; // Already 1-based, but ensure integer
          } else if (key === "weightSum" && row[key] !== undefined) {
            td.textContent = row[key];
          } else {
            td.textContent = row[key];
          }
          tr.appendChild(td);
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
      let lastColumns = selectedAttributes ? selectedAttributes.slice() : [];
      setInterval(() => {
        const currentColumns = selectedAttributes
          ? selectedAttributes.slice()
          : [];
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
  updateAll();

  // #endregion
});
