import mapboxgl from 'https://cdn.jsdelivr.net/npm/mapbox-gl@2.15.0/+esm';
import * as d3 from 'https://cdn.jsdelivr.net/npm/d3@7.9.0/+esm';
import mapboxToken from './mapbox-token.js';

mapboxgl.accessToken = mapboxToken;

const map = new mapboxgl.Map({
    container: 'map',
    style: 'mapbox://styles/mapbox/streets-v12',
    center: [-71.09415, 42.36027],
    zoom: 12,
    minZoom: 5,
    maxZoom: 18,
});

const svg = d3.select('#map').append('svg');

const bikeLanePaint = {
    'line-color': '#228b22',
    'line-width': 3,
    'line-opacity': 0.55,
};

function computeStationTraffic(stations, departureTrips, arrivalTrips = departureTrips) {
    const departures = d3.rollup(
        departureTrips,
        (rows) => rows.length,
        (trip) => trip.start_station_id,
    );

    const arrivals = d3.rollup(
        arrivalTrips,
        (rows) => rows.length,
        (trip) => trip.end_station_id,
    );

    return stations.map((station) => {
        const stationDepartures = departures.get(station.short_name) ?? 0;
        const stationArrivals = arrivals.get(station.short_name) ?? 0;

        return {
            ...station,
            departures: stationDepartures,
            arrivals: stationArrivals,
            totalTraffic: stationDepartures + stationArrivals,
        };
    });
}

function tooltipText(station) {
    return `${station.name}: ${station.totalTraffic} trips (${station.departures} departures, ${station.arrivals} arrivals)`;
}

function formatTime(minutes) {
    const date = new Date(2000, 0, 1, 0, minutes);
    return date.toLocaleTimeString('en-US', {
        hour: 'numeric',
        minute: '2-digit',
    });
}

function minutesSinceMidnight(date) {
    return date.getHours() * 60 + date.getMinutes();
}

function buildMinuteBuckets(trips, minuteField) {
    const buckets = Array.from({ length: 1440 }, () => []);

    for (const trip of trips) {
        const minute = trip[minuteField];
        if (Number.isInteger(minute)) {
            buckets[minute].push(trip);
        }
    }

    return buckets;
}

function filterByMinute(buckets, minute) {
    const matchingTrips = [];

    for (let offset = -60; offset <= 60; offset++) {
        const index = (minute + offset + 1440) % 1440;

        for (const trip of buckets[index]) {
            matchingTrips.push(trip);
        }
    }

    return matchingTrips;
}

const stationFlow = d3.scaleQuantize().domain([0, 1]).range([0, 0.5, 1]);

function departureRatio(station) {
    return station.totalTraffic === 0
        ? 0.5
        : stationFlow(station.departures / station.totalTraffic);
}

map.on('load', async () => {
    map.addSource('boston-route', {
        type: 'geojson',
        data: 'https://bostonopendata-boston.opendata.arcgis.com/datasets/boston::existing-bike-network-2022.geojson',
    });

    map.addLayer({
        id: 'boston-bike-lanes',
        type: 'line',
        source: 'boston-route',
        paint: bikeLanePaint,
    });

    map.addSource('cambridge-route', {
        type: 'geojson',
        data: 'https://raw.githubusercontent.com/cambridgegis/cambridgegis_data/main/Recreation/Bike_Facilities/RECREATION_BikeFacilities.geojson',
    });

    map.addLayer({
        id: 'cambridge-bike-lanes',
        type: 'line',
        source: 'cambridge-route',
        paint: bikeLanePaint,
    });

    const stationData = await d3.json(
        'https://dsc106.com/labs/lab07/data/bluebikes-stations.json',
    );

    const trips = await d3.csv(
        'https://dsc106.com/labs/lab07/data/bluebikes-traffic-2024-03.csv',
        (trip) => {
            trip.startMinute = minutesSinceMidnight(new Date(trip.started_at));
            trip.endMinute = minutesSinceMidnight(new Date(trip.ended_at));
            return trip;
        },
    );

    const departuresByMinute = buildMinuteBuckets(trips, 'startMinute');
    const arrivalsByMinute = buildMinuteBuckets(trips, 'endMinute');

    const stations = computeStationTraffic(stationData.data.stations, trips);
    console.table(stations.slice(0, 5), [
        'short_name',
        'departures',
        'arrivals',
        'totalTraffic',
    ]);

    const radiusScale = d3
        .scaleSqrt()
        .domain([0, d3.max(stations, (station) => station.totalTraffic)])
        .range([0, 25]);

    const circles = svg
        .selectAll('circle')
        .data(stations)
        .join('circle')
        .attr('r', (station) => radiusScale(station.totalTraffic));
    circles.append('title').text(tooltipText);

    function updatePositions() {
        circles.each(function (station) {
            const { x, y } = map.project([+station.lon, +station.lat]);
            d3.select(this).attr('cx', x).attr('cy', y);
        });
    }

    updatePositions();
    map.on('move', updatePositions);
    map.on('resize', updatePositions);
    const timeSlider = document.getElementById('time-slider');
    const selectedTime = document.getElementById('selected-time');
    const anyTimeLabel = document.getElementById('any-time');

    function updateScatterPlot(timeFilter) {
        const isAnyTime = timeFilter === -1;
        const filteredStations = isAnyTime
            ? stations
            : computeStationTraffic(
                stations,
                filterByMinute(departuresByMinute, timeFilter),
                filterByMinute(arrivalsByMinute, timeFilter),
            );

        radiusScale.range(isAnyTime ? [0, 25] : [3, 50]);

        circles
            .data(filteredStations)
            .attr('r', (station) =>
                station.totalTraffic === 0 ? 0 : radiusScale(station.totalTraffic),
            )
            .style('--departure-ratio', departureRatio);

        circles.select('title').text(tooltipText);
    }

    function updateTimeDisplay() {
        const timeFilter = Number(timeSlider.value);
        const isAnyTime = timeFilter === -1;

        selectedTime.hidden = isAnyTime;
        anyTimeLabel.hidden = !isAnyTime;
        selectedTime.textContent = isAnyTime ? '' : formatTime(timeFilter);
        updateScatterPlot(timeFilter);
    }

    timeSlider.disabled = false;
    timeSlider.addEventListener('input', updateTimeDisplay);
    updateTimeDisplay();
});