const urls = {
  // source: https://observablehq.com/@mbostock/u-s-airports-voronoi
  // source: https://github.com/topojson/us-atlas
  map: "states-albers-10m.json",

  // source: https://gist.github.com/mbostock/7608400
  airports:
    "https://gist.githubusercontent.com/mbostock/7608400/raw/e5974d9bba45bc9ab272d98dd7427567aafd55bc/airports.csv",

  // source: https://gist.github.com/mbostock/7608400
  flights:
    "https://gist.githubusercontent.com/mbostock/7608400/raw/e5974d9bba45bc9ab272d98dd7427567aafd55bc/flights.csv"
};

const svg  = d3.select("svg");

const width  = parseInt(svg.attr("width"));
const height = parseInt(svg.attr("height"));
const hypotenuse = Math.sqrt(width * width + height * height);

// must be hard-coded to match our topojson projection
// source: https://github.com/topojson/us-atlas
const projection = d3.geoAlbers().scale(1280).translate([480, 300]);

const scales = {
  // used to scale airport bubbles
  airports: d3.scaleSqrt()
    .range([4, 18]),

  // used to scale number of segments per line
  segments: d3.scaleLinear()
    .domain([0, hypotenuse])
    .range([1, 10])
};

// have these already created for easier drawing
const g = {
  basemap:  svg.select("g#basemap"),
  flights:  svg.select("g#flights"),
  airports: svg.select("g#airports"),
  voronoi:  svg.select("g#voronoi")
};

console.assert(g.basemap.size()  === 1);
console.assert(g.flights.size()  === 1);
console.assert(g.airports.size() === 1);
console.assert(g.voronoi.size()  === 1);

const tooltip = d3.select("text#tooltip");
console.assert(tooltip.size() === 1);

// load and draw base map
d3.json(urls.map).then(drawMap);

// load the airport and flight data together
const promises = [
  d3.csv(urls.airports, typeAirport),
  d3.csv(urls.flights,  typeFlight)
];

Promise.all(promises).then(processData);

// process airport and flight data
function processData(values) {
  console.assert(values.length === 2);

  let airports = values[0];
  let flights  = values[1];

  console.log("airports: " + airports.length);
  console.log(" flights: " + flights.length);

  // convert airports array (pre filter) into map for fast lookup
  let iata = new Map(airports.map(node => [node.iata, node]));

  // calculate incoming and outgoing degree based on flights
  // flights are given by airport iata code (not index)
  flights.forEach(function(link) {
    link.source = iata.get(link.origin);
    link.target = iata.get(link.destination);

    link.source.outgoing += link.count;
    link.target.incoming += link.count;
  });

  // remove airports out of bounds
  let old = airports.length;
  airports = airports.filter(airport => airport.x >= 0 && airport.y >= 0);
  console.log(" removed: " + (old - airports.length) + " airports out of bounds");

  // remove airports with NA state
  old = airports.length;
  airports = airports.filter(airport => airport.state !== "NA");
  console.log(" removed: " + (old - airports.length) + " airports with NA state");

  // remove airports without any flights
  old = airports.length;
  airports = airports.filter(airport => airport.outgoing > 0 && airport.incoming > 0);
  console.log(" removed: " + (old - airports.length) + " airports without flights");

  // sort airports by outgoing degree
  airports.sort((a, b) => d3.descending(a.outgoing, b.outgoing));

  // keep only the top airports
  old = airports.length;
  airports = airports.slice(0, 50);
  console.log(" removed: " + (old - airports.length) + " airports with low outgoing degree");

  // done filtering airports can draw
  drawAirports(airports);
  drawPolygons(airports);

  // reset map to only include airports post-filter
  iata = new Map(airports.map(node => [node.iata, node]));

  // filter out flights that are not between airports we have leftover
  old = flights.length;
  flights = flights.filter(link => iata.has(link.source.iata) && iata.has(link.target.iata));
  console.log(" removed: " + (old - flights.length) + " flights");

  // done filtering flights can draw
  drawFlights(airports, flights);

  console.log({airports: airports});
  console.log({flights: flights});
}

// draws the underlying map
function drawMap(map) {
  // remove non-continental states
  map.objects.states.geometries = map.objects.states.geometries.filter(isContinental);

  // run topojson on remaining states and adjust projection
  let land = topojson.merge(map, map.objects.states.geometries);

  // use null projection; data is already projected
  let path = d3.geoPath();

  // draw base map
  g.basemap.append("path")
    .datum(land)
    .attr("class", "land")
    .attr("d", path);

  // draw interior borders
  g.basemap.append("path")
    .datum(topojson.mesh(map, map.objects.states, (a, b) => a !== b))
    .attr("class", "border interior")
    .attr("d", path);

  // draw exterior borders
  g.basemap.append("path")
    .datum(topojson.mesh(map, map.objects.states, (a, b) => a === b))
    .attr("class", "border exterior")
    .attr("d", path);
}

function drawAirports(airports) {
  // adjust scale
  const extent = d3.extent(airports, d => d.outgoing);
  scales.airports.domain(extent);

  // draw airport bubbles
  g.airports.selectAll("circle.airport")
    .data(airports, d => d.iata)
    .enter()
    .append("circle")
    .attr("r",  d => scales.airports(d.outgoing))
    .attr("cx", d => d.x) // calculated on load
    .attr("cy", d => d.y) // calculated on load
    .attr("class", "airport")
    .each(function(d) {
      // adds the circle object to our airport
      // makes it fast to select airports on hover
      d.bubble = this;
    });
}

function drawPolygons(airports) {
  // convert array of airports into geojson format
  const geojson = airports.map(function(airport) {
    return {
      type: "Feature",
      properties: airport,
      geometry: {
        type: "Point",
        coordinates: [airport.longitude, airport.latitude]
      }
    };
  });

  // calculate voronoi polygons
  const polygons = d3.geoVoronoi().polygons(geojson);
  console.log(polygons);

  g.voronoi.selectAll("path")
    .data(polygons.features)
    .enter()
    .append("path")
    .attr("d", d3.geoPath(projection))
    .attr("class", "voronoi")
    .on("mouseover", function(d) {
      let airport = d.properties.site.properties;

      d3.select(airport.bubble)
        .classed("highlight", true);

      d3.selectAll(airport.flights)
        .classed("highlight", true)
        .raise();

      // make tooltip take up space but keep it invisible
      tooltip.style("display", null);
      tooltip.style("visibility", "hidden");

      // set default tooltip positioning
      tooltip.attr("text-anchor", "middle");
      tooltip.attr("dy", -scales.airports(airport.outgoing) - 4);
      tooltip.attr("x", airport.x);
      tooltip.attr("y", airport.y);

      // set the tooltip text
      tooltip.text(airport.name + " in " + airport.city + ", " + airport.state);

      // double check if the anchor needs to be changed
      let bbox = tooltip.node().getBBox();

      if (bbox.x <= 0) {
        tooltip.attr("text-anchor", "start");
      }
      else if (bbox.x + bbox.width >= width) {
        tooltip.attr("text-anchor", "end");
      }

      tooltip.style("visibility", "visible");
    })
    .on("mouseout", function(d) {
      let airport = d.properties.site.properties;

      d3.select(airport.bubble)
        .classed("highlight", false);

      d3.selectAll(airport.flights)
        .classed("highlight", false);

      d3.select("text#tooltip").style("visibility", "hidden");
    })
    .on("dblclick", function(d) {
      // toggle voronoi outline
      let toggle = d3.select(this).classed("highlight");
      d3.select(this).classed("highlight", !toggle);
    });
}

function drawFlights(airports, flights) {
  // break each flight between airports into multiple segments
  let bundle = generateSegments(airports, flights);

  // https://github.com/d3/d3-shape#curveBundle
  let line = d3.line()
    .curve(d3.curveBundle)
    .x(airport => airport.x)
    .y(airport => airport.y);

  let links = g.flights.selectAll("path.flight")
    .data(bundle.paths)
    .enter()
    .append("path")
    .attr("d", line)
    .attr("class", "flight")
    .each(function(d) {
      // adds the path object to our source airport
      // makes it fast to select outgoing paths
      d[0].flights.push(this);
    });

  // https://github.com/d3/d3-force
  let layout = d3.forceSimulation()
    // settle at a layout faster
    .alphaDecay(0.1)
    // nearby nodes attract each other
    .force("charge", d3.forceManyBody()
      .strength(10)
      .distanceMax(scales.airports.range()[1] * 2)
    )
    // edges want to be as short as possible
    // prevents too much stretching
    .force("link", d3.forceLink()
      .strength(0.7)
      .distance(0)
    )
    .on("tick", function(d) {
      links.attr("d", line);
    })
    .on("end", function(d) {
      console.log("layout complete");
    });

  layout.nodes(bundle.nodes).force("link").links(bundle.links);
}

// Turns a single edge into several segments that can
// be used for simple edge bundling.
function generateSegments(nodes, links) {
  // generate separate graph for edge bundling
  // nodes: all nodes including control nodes
  // links: all individual segments (source to target)
  // paths: all segments combined into single path for drawing
  let bundle = {nodes: [], links: [], paths: []};

  // make existing nodes fixed
  bundle.nodes = nodes.map(function(d, i) {
    d.fx = d.x;
    d.fy = d.y;
    return d;
  });

  links.forEach(function(d, i) {
    // calculate the distance between the source and target
    let length = distance(d.source, d.target);

    // calculate total number of inner nodes for this link
    let total = Math.round(scales.segments(length));

    // create scales from source to target
    let xscale = d3.scaleLinear()
      .domain([0, total + 1]) // source, inner nodes, target
      .range([d.source.x, d.target.x]);

    let yscale = d3.scaleLinear()
      .domain([0, total + 1])
      .range([d.source.y, d.target.y]);

    // initialize source node
    let source = d.source;
    let target = null;

    // add all points to local path
    let local = [source];

    for (let j = 1; j <= total; j++) {
      // calculate target node
      target = {
        x: xscale(j),
        y: yscale(j)
      };

      local.push(target);
      bundle.nodes.push(target);

      bundle.links.push({
        source: source,
        target: target
      });

      source = target;
    }

    local.push(d.target);

    // add last link to target node
    bundle.links.push({
      source: target,
      target: d.target
    });

    bundle.paths.push(local);
  });

  return bundle;
}

// determines which states belong to the continental united states
// https://gist.github.com/mbostock/4090846#file-us-state-names-tsv
function isContinental(state) {
  const id = parseInt(state.id);
  return id < 60 && id !== 2 && id !== 15;
}

// see airports.csv
// convert gps coordinates to number and init degree
function typeAirport(airport) {
  airport.longitude = parseFloat(airport.longitude);
  airport.latitude  = parseFloat(airport.latitude);

  // use projection hard-coded to match topojson data
  const coords = projection([airport.longitude, airport.latitude]);
  airport.x = coords[0];
  airport.y = coords[1];

  airport.outgoing = 0;  // eventually tracks number of outgoing flights
  airport.incoming = 0;  // eventually tracks number of incoming flights

  airport.flights = [];  // eventually tracks outgoing flights

  return airport;
}

// see flights.csv
// convert count to number
function typeFlight(flight) {
  flight.count = parseInt(flight.count);
  return flight;
}

// calculates the distance between two nodes
// sqrt( (x2 - x1)^2 + (y2 - y1)^2 )
function distance(source, target) {
  const dx2 = Math.pow(target.x - source.x, 2);
  const dy2 = Math.pow(target.y - source.y, 2);

  return Math.sqrt(dx2 + dy2);
}
