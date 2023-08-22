const lat_lng_pure = [];
const visited_place = new Map();
const in_queue_place = new Set();

var BASE32_CODES = "0123456789bcdefghjkmnpqrstuvwxyz";
var BASE32_CODES_DICT = {};
for (var i = 0; i < BASE32_CODES.length; i++) {
    BASE32_CODES_DICT[BASE32_CODES.charAt(i)] = i;
}

var ENCODE_AUTO = 'auto';

var MIN_LAT = -90;
var MAX_LAT = 90;
var MIN_LON = -180;
var MAX_LON = 180;
var SIGFIG_HASH_LENGTH = [0, 5, 7, 8, 11, 12, 13, 15, 16, 17, 18];

function ensure_valid_lon(lon) {
    if (lon > MAX_LON)
        return MIN_LON + lon % MAX_LON;
    if (lon < MIN_LON)
        return MAX_LON + lon % MAX_LON;
    return lon;
};

function ensure_valid_lat(lat) {
    if (lat > MAX_LAT)
        return MAX_LAT;
    if (lat < MIN_LAT)
        return MIN_LAT;
    return lat;
};

var encode = function (latitude, longitude, numberOfChars) {
    if (numberOfChars === ENCODE_AUTO) {
        if (typeof (latitude) === 'number' || typeof (longitude) === 'number') {
            throw new Error('string notation required for auto precision.');
        }
        var decSigFigsLat = latitude.split('.')[1].length;
        var decSigFigsLong = longitude.split('.')[1].length;
        var numberOfSigFigs = Math.max(decSigFigsLat, decSigFigsLong);
        numberOfChars = SIGFIG_HASH_LENGTH[numberOfSigFigs];
    } else if (numberOfChars === undefined) {
        numberOfChars = 9;
    }

    var chars = [],
        bits = 0,
        bitsTotal = 0,
        hash_value = 0,
        maxLat = MAX_LAT,
        minLat = MIN_LAT,
        maxLon = MAX_LON,
        minLon = MIN_LON,
        mid;
    while (chars.length < numberOfChars) {
        if (bitsTotal % 2 === 0) {
            mid = (maxLon + minLon) / 2;
            if (longitude > mid) {
                hash_value = (hash_value << 1) + 1;
                minLon = mid;
            } else {
                hash_value = (hash_value << 1) + 0;
                maxLon = mid;
            }
        } else {
            mid = (maxLat + minLat) / 2;
            if (latitude > mid) {
                hash_value = (hash_value << 1) + 1;
                minLat = mid;
            } else {
                hash_value = (hash_value << 1) + 0;
                maxLat = mid;
            }
        }

        bits++;
        bitsTotal++;
        if (bits === 5) {
            var code = BASE32_CODES[hash_value];
            chars.push(code);
            bits = 0;
            hash_value = 0;
        }
    }
    return chars.join('');
};

var decode = function (hashString) {
    var bbox = decode_bbox(hashString);
    var lat = (bbox[0] + bbox[2]) / 2;
    var lon = (bbox[1] + bbox[3]) / 2;
    var latErr = bbox[2] - lat;
    var lonErr = bbox[3] - lon;
    return {
        latitude: lat, longitude: lon,
        error: { latitude: latErr, longitude: lonErr }
    };
};


var decode_bbox = function (hash_string) {
    var isLon = true,
        maxLat = MAX_LAT,
        minLat = MIN_LAT,
        maxLon = MAX_LON,
        minLon = MIN_LON,
        mid;

    var hashValue = 0;
    for (var i = 0, l = hash_string.length; i < l; i++) {
        var code = hash_string[i].toLowerCase();
        hashValue = BASE32_CODES_DICT[code];

        for (var bits = 4; bits >= 0; bits--) {
            var bit = (hashValue >> bits) & 1;
            if (isLon) {
                mid = (maxLon + minLon) / 2;
                if (bit === 1) {
                    minLon = mid;
                } else {
                    maxLon = mid;
                }
            } else {
                mid = (maxLat + minLat) / 2;
                if (bit === 1) {
                    minLat = mid;
                } else {
                    maxLat = mid;
                }
            }
            isLon = !isLon;
        }
    }
    return [minLat, minLon, maxLat, maxLon];
};

var neighbors = function (hash_string) {

    var hashstringLength = hash_string.length;

    var lonlat = decode(hash_string);
    var lat = lonlat.latitude;
    var lon = lonlat.longitude;
    var latErr = lonlat.error.latitude * 2;
    var lonErr = lonlat.error.longitude * 2;

    var neighbor_lat,
        neighbor_lon;

    var neighborHashList = [
        encodeNeighbor(1, 0),
        encodeNeighbor(1, 1),
        encodeNeighbor(0, 1),
        encodeNeighbor(-1, 1),
        encodeNeighbor(-1, 0),
        encodeNeighbor(-1, -1),
        encodeNeighbor(0, -1),
        encodeNeighbor(1, -1)
    ];

    function encodeNeighbor(neighborLatDir, neighborLonDir) {
        neighbor_lat = lat + neighborLatDir * latErr;
        neighbor_lon = lon + neighborLonDir * lonErr;
        neighbor_lon = ensure_valid_lon(neighbor_lon);
        neighbor_lat = ensure_valid_lat(neighbor_lat);
        return encode(neighbor_lat, neighbor_lon, hashstringLength);
    }

    return neighborHashList;
};

var is_point_inside_polyline = function (point, polyline) {
    var x = point[0],
        y = point[1];

    var inside = false;
    for (var i = 0, j = polyline.length - 1; i < polyline.length; j = i++) {
        var xi = polyline[i][0],
            yi = polyline[i][1];

        var xj = polyline[j][0],
            yj = polyline[j][1];

        var intersect = ((yi > y) !== (yj > y)) &&
            (x < (xj - xi) * (y - yi) / (yj - yi) + xi);

        if (intersect) inside = !inside;
    }

    return inside;
}

var fuse_arrays = function (...arrays) {
    return arrays.reduce((result, array) => [...result, ...array], []);
}


var generate_geohash_grid = function (areaCoords, precision) {
    areaCoords.forEach(element => {
        lat_lng_pure.push([element.lat, element.lng]);
        const hash = encode(element.lat, element.lng, precision)
        if (!in_queue_place.has(hash)) {
            in_queue_place.add(hash);
        }
    });
    visit_neighbors();
    return visited_place;
}

var visit_neighbors = function () {
    while (true) {
        if (in_queue_place.size > 0) {
            const [first] = in_queue_place;
            in_queue_place.delete(first)
            if (!visited_place.has(first)) {
                let bounds = decode_bbox(first)

                let bound_tl_br = [[bounds[0], bounds[1]], [bounds[2], bounds[3]]],
                    bound_tr_bl = [[bounds[2], bounds[1]], [bounds[0], bounds[3]]];
                let done = false;
                let bounds_all = fuse_arrays(bound_tl_br, bound_tr_bl)
                bounds_all.forEach(bound => {
                    if (!done) {
                        let is_inside = is_point_inside_polyline(bound, lat_lng_pure)
                        if (is_inside) {
                            let neighbors_hash = neighbors(first);
                            neighbors_hash.forEach(neighbor => {
                                if (!visited_place.has(neighbor) && !in_queue_place.has(neighbor)) {
                                    in_queue_place.add(neighbor)
                                }
                            });
                            done = true
                            visited_place.set(first, bounds_all)
                        }
                    }
                });
            }
        } else {
            break;
        }
    }
}