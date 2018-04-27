/*
 * Copyright 2017-2018 Crown Copyright
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

'use strict'

angular.module('app').component('resultsChart', resultsChart());

function resultsChart() {
    return {
        templateUrl: 'app/chart/chart.html',
        controller: ChartController,
        controllerAs: 'ctrl'
    };
}

/**
 * The controller for the chart page..
 * @param {*} schema For looking up information about the different groups and types.
 * @param {*} results For retrieving the results
 * @param {*} table For caching user table view preferences
 * @param {*} events For subscribing to resultsUpdated events
 * @param {*} common For common methods
 * @param {*} types For converting objects based on their types
 * @param {*} time For converting time objects
 */
function ChartController(schema, results, chart, events, common, types, time, error) {
    var maxXaxisValues = 50;
    var freq = "FREQUENCY";
    
    var vm = this;
    var resultsByType = [];
    vm.searchTerm = undefined;
    vm.data = {results:[], column:'count'};
    vm.searchTerm = '';
    vm.sortType = undefined;
    vm.schema = {edges:{}, entities:{}, types:{}};

    vm.chartData = [];
    vm.chartLabels = [];
    

    /**
     * Initialises the controller.
     * Fetches the schema. Fetches the results and processes them.
     * Subscribes to resultsUpdated events.
     */
    vm.$onInit = function() {
        schema.get().then(function(gafferSchema) {
            vm.schema = gafferSchema;
            processResults(results.get());
            events.subscribe('resultsUpdated', onResultsUpdated);
        });
    }

    /**
     * Cleans up the controller. Unsubscribes from resultsUpdated events
     */
    vm.$onDestroy = function() {
        events.unsubscribe('resultsUpdated', onResultsUpdated);
    }

    vm.updateFilteredResults = function() {
        vm.data.results = [];
        for(var t in vm.data.types) {
            if(vm.data.types[t] in resultsByType) {
                for(var g in vm.data.groups) {
                    if(vm.data.groups[g] in resultsByType[vm.data.types[t]]) {
                        vm.data.results = vm.data.results.concat(resultsByType[vm.data.types[t]][vm.data.groups[g]]);
                    }
                }
            }
        }

        vm.chartLabels = [];
        vm.chartData = [];
        var xValues = [];
        var yValues = [];
        for(var i in vm.data.results) {
            var result = vm.data.results[i];
            if(result[vm.xaxis] !== undefined) {
               xValues.push(result[vm.xaxis]);
               yValues.push(result[vm.yaxis] !== undefined ? result[vm.yaxis] : 1)
            }
        }

        var dedupedValues = [];
        common.pushValuesIfUnique(xValues, dedupedValues);
        
        if(isNumberValue()) {
            var numBuckets = Math.min(dedupedValues.length, maxXaxisValues);
            var min = Math.min.apply(0, xValues);
            var max = Math.max.apply(0, xValues);
            var bucketSize = (max - min)/numBuckets;
            var buckets = [];
            vm.chartLabels = [];
            for(var i = 0; i<numBuckets; i++) {
                buckets.push(0);
                var bucketValue = min + bucketSize * (i + 0.5);
                if(isInteger()) {
                    bucketValue = Math.round(bucketValue);
                }
                if(isTime()) {
                    bucketValue =  time.getDateString(vm.xaxis, bucketValue);
                }
                vm.chartLabels.push(bucketValue);
            }
            for(var i in xValues) {
                var value = xValues[i];
                var bucketIndex = Math.floor((value-min)/bucketSize);
                if(bucketIndex >= numBuckets) {
                    bucketIndex = numBuckets - 1;
                }
                buckets[bucketIndex] += yValues[i];
            }
            vm.chartData = buckets;
        } else {
            if(dedupedValues.length > maxXaxisValues) {
                error.handle("Too many different values to show on x-axis. Only the first " + maxXaxisValues + " will be shown.");
                dedupedValues.splice(0, dedupedValues + 1);
            }
            dedupedValues.sort();
            vm.chartLabels = dedupedValues;
            vm.chartData = [];
            for(var i in xValues) {
                var index = dedupedValues.indexOf(xValues[i]);
                if(index > -1) {
                    if(vm.chartData[index]) {
                        vm.chartData[index] += yValues[i];
                    } else {
                        vm.chartData[index] = yValues[i];
                    }
                }
            }
        }
    }

    var isNumberValue = function() {
        return isInteger() || isTime();
    }

    var isInteger = function() {
        return 'count' === vm.xaxis || isTime();
    }

    var isTime = function() {
        return time.isTimeProperty(vm.xaxis);
    }

    /*
     * Text for the select types component - 'type'
     */
    vm.selectedTypesText = function() {
        return "type";
    }

    /*
     * Text for the select groups component - 'group'
     */
    vm.selectedGroupsText = function() {
        return "group";
    }

    vm.onPropertyChange = function() {
        vm.updateFilteredResults();
    }

    var onResultsUpdated = function(res) {
        processResults(res);
    }

    var processResults = function(resultsData) {
        var ids = [];
        var groupByProperties = [];
        var properties = [];
        resultsByType = {};
        vm.data.tooltips = {};

        processElements("Edge", "edges", ["type", "group", "source", "destination", "directed"], ids, groupByProperties, properties, resultsData);
        processElements("Entity", "entities", ["type", "group", "source"], ids, groupByProperties, properties, resultsData);
        processOtherTypes(ids, properties, resultsData);

        vm.allYaxis = [];
        vm.allXaxis = common.concatUniqueValues(common.concatUniqueValues(ids, groupByProperties), properties);
        if(vm.allXaxis.indexOf('count') > -1) {
            vm.xaxis = 'count';
            vm.allYaxis.push('count');
        } else if(vm.allXaxis.length > 0) {
            vm.xaxis = vm.allXaxis[0];
        } else {
            vm.xaxis = undefined;
        }
        vm.yaxis = 'FREQUENCY'

        vm.data.allTypes = [];
        vm.data.allGroups = [];
        for(var type in resultsByType) {
            vm.data.allTypes.push(type);
            for(var group in resultsByType[type]) {
                common.pushValueIfUnique(group, vm.data.allGroups);
            }
        }
        vm.data.types = angular.copy(vm.data.allTypes);
        vm.data.groups = angular.copy(vm.data.allGroups);

        vm.updateFilteredResults();
    }

    var processElements = function(type, typePlural, idKeys, ids, groupByProperties, properties, resultsData) {
        if(resultsData[typePlural] && Object.keys(resultsData[typePlural]).length > 0) {
            resultsByType[type] = [];
            common.pushValuesIfUnique(idKeys, ids);
            for(var i in resultsData[typePlural]) {
                var element = resultsData[typePlural][i];
                if(element) {
                    var result = {};
                    for(var idIndex in idKeys) {
                        var id = idKeys[idIndex];
                        if('source' === id && element.source === undefined) {
                            result[id] = element.vertex;
                        } else {
                            result[id] = element[id];
                        }
                    }
                    result.type = type;

                    if(element.properties) {
                        if(!(element.group in resultsByType[type])) {
                            resultsByType[type][element.group] = [];

                            var elementDef = vm.schema[typePlural][element.group];
                            if(elementDef && elementDef.properties) {
                                if(elementDef.groupBy) {
                                    for(var j in elementDef.groupBy) {
                                        var propName = elementDef.groupBy[j];
                                        var typeDef = vm.schema.types[elementDef.properties[propName]];
                                        if(typeDef && typeDef.description && !(propName in vm.data.tooltips)) {
                                            vm.data.tooltips[propName] = typeDef.description;
                                        }
                                        common.pushValueIfUnique(propName, groupByProperties);
                                     }
                                 }
                                 for(var propName in elementDef.properties) {
                                    var typeDef = vm.schema.types[elementDef.properties[propName]];
                                    if(typeDef && typeDef.description && !(propName in vm.data.tooltips)) {
                                        vm.data.tooltips[propName] = typeDef.description;
                                    }
                                    common.pushValueIfUnique(propName, properties);
                                 }
                            }
                        }
                        for(var prop in element.properties) {
                            common.pushValueIfUnique(prop, properties);
                            result[prop] = convertValue(prop, element.properties[prop]);
                        }
                    }
                    if(!(element.group in resultsByType[type])) {
                        resultsByType[type][element.group] = [];
                    }
                    resultsByType[type][element.group].push(result);
                }
            }
        }
    }

    var processOtherTypes = function(ids, properties, resultsData) {
        for (var i in resultsData.other) {
            var item = resultsData.other[i];
            if(item) {
                var result = {group: ''};
                for(var key in item) {
                    var value = convertValue(key, item[key]);
                    if("class" === key) {
                        result["type"] = item[key].split(".").pop();
                        common.pushValueIfUnique("type", ids);
                    } else if("vertex" === key) {
                        result["source"] = value;
                        common.pushValueIfUnique("source", ids);
                    } else if("source" === key) {
                        result["source"] = value;
                        common.pushValueIfUnique("source", ids);
                    } else if("value" === key) {
                        result[key] = value;
                        common.pushValueIfUnique(key, ids);
                    } else {
                        result[key] = value;
                        common.pushValueIfUnique(key, properties);
                    }
                }
                if(!(result.type in resultsByType)) {
                    resultsByType[result.type] = {};
                }
                if(!(result.group in resultsByType[result.type])) {
                    resultsByType[result.type][result.group] = [];
                }
                resultsByType[result.type][result.group].push(result);
            }
        }
    }

    var convertValue = function(name, value) {
        var parsedValue = value;
        if(parsedValue) {
            try {
                parsedValue = JSON.parse(value);
            } catch(e) {
                parsedValue = value;
            }
            parsedValue = types.getShortValue(parsedValue);
        }
        return parsedValue;
    }
}
