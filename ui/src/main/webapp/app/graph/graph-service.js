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

'use strict';

/**
 * Graph service which handles selected elements and a cytoscape graph
 */
angular.module('app').factory('graph', ['types', '$q', 'results', 'common', 'config', 'events', 'input', 'schema', 'query', 'operationService', 'settings', 'loading', '$mdDialog', 'error', function(types, $q, results, common, config, events, input, schemaService, query, operationService, settings, loading, $mdDialog, error) {
    var graphCy;
    var graph = {};
    var selectedEntities = {};
    var selectedEdges = {};
    var schema = {entities:{}, edges:{}, types:{}};
    var tappedBefore;
    var tappedTimeout;

    var layoutConf = {
        name: 'cytoscape-ngraph.forcelayout',
        async: {
            maxIterations: 1000,
            stepsPerCycle: 50,
            waitForStep: true
        },
        physics: {
            springLength: 250,
            gravity: -6,
            theta: 0.95,
            fit: true
        },
        iterations: 10000,
        fit: true,
        animate: false
    };

    var graphData = {entities: {}, edges: {}};

    var style = {
        entity: {
            general: {
              'text-valign': 'top',
              'font-size': 14,
              'text-outline-color':'#fff',
              'text-outline-width':2,
              'width': '30',
              'height': '30',
              'shape': 'circle',
              'background-fit': 'cover',
              'background-clip': 'none',
              'padding': '0px',
              'min-zoomed-font-size': 10,
              'default-color': '#aaa',
              'selected-color': '#777'
            },
            hasEntities: {
              'width': '30',
              'height': '30',
              'border-color': '#555',
              'border-width': 2
            }
        },
        edge: {
            general: {
                'curve-style': 'bezier',
                'target-arrow-shape': 'triangle',
                'font-size': 14,
                'color': '#fff',
                'text-outline-width':3,
                'width': 5,
                'min-zoomed-font-size': 30,
                'default-color': '#aaa',
                'selected-color': '#777'
            }
        },
        entities: {},
        edges: {}
    };

    var applyEntityStyle = function(type, hasEntities, entity) {
        var entityStyle = angular.copy(style.entity.general);
        if(hasEntities) {
            angular.merge(entityStyle, angular.copy(style.entity.hasEntities));
        }
        if(type in style.entities) {
            angular.merge(entityStyle, angular.copy(style.entities[type]));
        }
        if('icon-name' in entityStyle) {
            entityStyle['background-image'] = 'app/img/material-icons/' + entityStyle['icon-name'] + '_24px.svg'
            entityStyle.shape = 'roundrectangle';
            entityStyle['default-color'] = '#fff';
        } else if('background-image' in entityStyle) {
            entityStyle.shape = 'roundrectangle';
            entityStyle['default-color'] = '#fff';
        }

        if(!('data' in entity)) {
            entity.data = {};
        }
        entity.data.type = type;
        entity.data.hasEntities = hasEntities;
        entity.data.defaultColor = entityStyle['default-color'];
        entity.data.selectedColor = entityStyle['selected-color'];
        entity.style = entityStyle;
    }

    var applyEdgeStyle = function(type, edge) {
        var edgeStyle = angular.copy(style.edge.general);
        if(type in style.edges) {
            angular.merge(edgeStyle, angular.copy(style.edges[type]));
        }

        if(!('data' in edge)) {
            edge.data = {};
        }
        edge.data.defaultColor = edgeStyle['default-color'];
        edge.data.selectedColor = edgeStyle['selected-color'];
        edge.style = edgeStyle;
    }

    config.get().then(function(conf) {
        if(conf.graph && conf.graph.physics) {
            angular.merge(layoutConf.physics, conf.graph.physics);
            graph.redraw();
        }
    });

    schemaService.get().then(function(gafferSchema) {
        schema = gafferSchema;
    });

    schemaService.getStyle().then(function(schemaStyle) {
        angular.merge(style, angular.copy(schemaStyle));
    });

    events.subscribe('resultsUpdated', function(results) {
        graph.update(results);
    });

    /** 
     * Returns the currently selected entities in the graph
    */
    graph.getSelectedEntities = function() {
        return selectedEntities;
    }

    /** 
     * Returns the currently selected edges in the graph
    */
    graph.getSelectedEdges = function() {
        return selectedEdges;
    }

    /**
     * Loads cytoscape graph onto an element containing the "graphCy" id. It also registers the 
     * handlers for select and deselect events.
     */
    graph.load = function() {
        var deferred = $q.defer();
        graphCy = cytoscape({
            container: $('#graphCy')[0],
            style: [
                {
                    selector: 'node',
                    style: {
                        'content': 'data(label)',
                        'background-color': 'data(defaultColor)'
                    }
                },
                {
                    selector: 'edge',
                    style: {
                        'label': 'data(group)',
                        'line-color': 'data(defaultColor)',
                        'target-arrow-color': 'data(defaultColor)',
                        'text-outline-color': 'data(defaultColor)'
                    }
                },
                {
                    selector: 'node:selected',
                    css: {
                        'background-color': 'data(selectedColor)'
                    }
                },
                {
                    selector: 'edge:selected',
                     css: {
                        'line-color': 'data(selectedColor)',
                        'target-arrow-color': 'data(selectedColor)',
                        'text-outline-color': 'data(selectedColor)'
                    }
                },
                {
                    selector: '.filtered',
                    css: {
                       display: "none"
                    }
                }
            ],
            layout: layoutConf,
            elements: [],
            ready: function(){
                deferred.resolve( this );
            }
        });

        graphCy.on('select', function(evt){
            select(evt.cyTarget);
        });

        graphCy.on('unselect', function(evt){
            unSelect(evt.cyTarget);
        })

        graphCy.on('tap', function(event) {
            var tappedNow = event.cyTarget;
            if (tappedTimeout && tappedBefore) {
                clearTimeout(tappedTimeout);
            }
            if(tappedBefore === tappedNow) {
                tappedNow.trigger('doubleTap');
                tappedBefore = null;
            } else {
                tappedTimeout = setTimeout(function(){ tappedBefore = null; }, 300);
                tappedBefore = tappedNow;
            }
        });

        graphCy.on('doubleTap', 'node', graph.quickHop);

        return deferred.promise;
    }

    /**
     * Performs a quick hop - a GetElements operation with either the clicked
     * node or the selected nodes.
     * @param {Object} event an optional mouse click event.
     */
    graph.quickHop = function(event) {
        var input
        if(event) {
            input = [event.cyTarget.id()];
        } else {
            input = Object.keys(graph.getSelectedEntities());
        }
        if(input && input.length > 0) {
            loading.load();
            var operation = {
                 class: "uk.gov.gchq.gaffer.operation.impl.get.GetElements",
                 input: createOpInput(input),
                 options: settings.getDefaultOpOptions(),
                 view: {
                    globalElements: [
                        {
                            groupBy: []
                        }
                    ]
                 }
            };
            query.addOperation(operation);
            query.executeQuery(
                {
                   class: "uk.gov.gchq.gaffer.operation.OperationChain",
                   operations: [
                       operation,
                       operationService.createLimitOperation(operation['options']),
                       operationService.createDeduplicateOperation(operation['options'])
                   ],
                   options: operation['options']
                },
                graph.deselectAll
            );
        } else {
            error.handle('Please select one or more vertices first');
        }
    }

    var createOpInput = function(seeds) {
        var opInput = [];
        for (var i in seeds) {
            opInput.push({
                "class": "uk.gov.gchq.gaffer.operation.data.EntitySeed",
                "vertex": JSON.parse(seeds[i])
            });
        }
        return opInput;
    }

    /**
     * Defines the behaviour when an element in cytoscape is selected. 
     * First attempts to select an entity, then edge, then vertex.
     * @param {Object} element 
     */
    function select(element) {
        if(selectEntityId(element.id())) {
            return;
        }

        if(selectEdgeId(element.id())) {
            return;
        }

        selectVertex(element.id());
    }

    /**
     * Appends the element to selected entities, creates an input object from the ID and adds it to the input service, then fires events
     * @param {String} id The vertex 
     * @param {Array} entities The elements with the id
     */
    function selectEntities(id, entities) {
        selectedEntities[id] = entities;
        schemaService.get().then(function(gafferSchema) {
            schema = gafferSchema;
            var vertex = JSON.parse(id);
            var vertices = schemaService.getSchemaVertices();
            var vertexClass = gafferSchema.types[vertices[0]].class;
            input.addInput({
                valueClass: vertexClass,
                parts: types.createParts(vertexClass, vertex)
            });
        });
        
        events.broadcast('selectedElementsUpdate', [{"entities": selectedEntities, "edges": selectedEdges}]);
    }

    /**
     * Selects all elements with the given vertex (entityId)
     * @param {String} entityId a stringified vertex
     * @returns true if entities were found in the array with the id
     * @returns false if no entities were found with the given id
     */
    function selectEntityId(entityId) {
        for (var id in graphData.entities) {
            if(entityId == id) {
                selectEntities(id, graphData.entities[id]);
                return true;
            }
        }
        return false;
    }

    /**
     * Adds the id and edges to the selected elements object, then fires update event.
     * @param {String} id The ID
     * @param {Array} edges The array of edges assocated with the id
     */
    function selectEdges(id, edges) {
        selectedEdges[id] = edges;
        events.broadcast('selectedElementsUpdate', [{"entities": selectedEntities, "edges": selectedEdges}]);
    }

    /**
     * Selects all edges in the graph with the given id
     * @param {String} edgeId The Edge ID
     * @returns true if an edge exists in the graph with the given id
     * @returns false if no edge was found in the graph with the given id
     */
    function selectEdgeId(edgeId) {
        for (var id in graphData.edges) {
            if(edgeId == id) {
                selectEdges(id, graphData.edges[id]);
                return true;
            }
        }
        return false;
    }

    /**
     * Adds a seed to the selected entities
     * @param {String} vertexId 
     */
    function selectVertex(vertexId) {
        selectEntities(vertexId, [{vertex: vertexId}]);
    }

    /**
     * Removes an element from the selected elements and input service and fires update events
     * @param {Object} element The cytoscape element 
     */
    function unSelect(element) {
        var id = element.id();
        if(id in selectedEntities) {
            input.removeInput(JSON.parse(id));
            delete selectedEntities[id];
        } else if(id in selectedEdges) {
            delete selectedEdges[id];
        }

        events.broadcast('selectedElementsUpdate', [{"entities": selectedEntities, "edges": selectedEdges}]);
    }

    /**
     * Resets the graph
     */
    graph.reset = function() {
        graph.update(results.get());
    }

    var isLoaded = function() {
        return graphCy && graphCy.isReady() && graphCy.style() !== undefined
    }

    /**
     * Adds Entities, Edges and seeds to the graph model.
     * @param {Array} results 
     */
    graph.update = function(results) {
        graph.clear();
        graphData = { entities: {}, edges: {} };
        if(!isLoaded()) {
            return;
        }
        for (var i in results.entities) {
            var entity = angular.copy(results.entities[i]);
            entity.vertex = common.parseVertex(entity.vertex);
            var id = entity.vertex;
            if(id in graphData.entities) {
                common.pushObjectIfUnique(entity, graphData.entities[id]);
            } else {
                graphData.entities[id] = [entity];
            }
        }

        for (var i in results.edges) {
            var edge = angular.copy(results.edges[i]);
            edge.source = common.parseVertex(edge.source);
            edge.destination = common.parseVertex(edge.destination);
            var id = edge.source + "|" + edge.destination + "|" + edge.directed + "|" + edge.group;
            if(id in graphData.edges) {
                common.pushObjectIfUnique(edge, graphData.edges[id]);
            } else {
                graphData.edges[id] = [edge];
            }
        }

        updateGraph(graphData);
    }

    /**
     * Updates cytoscape with the graph data
     * @param {Array} results 
     */
    var updateGraph = function(results) {
        for (var id in results.entities) {
            var entity = results.entities[id][0];
            var existingNodes = graphCy.getElementById(id);
            var isSelected = common.objectContainsValue(selectedEntities, id);
            if(existingNodes.length > 0) {
                if(isSelected) {
                   existingNodes.select();
                } else {
                   existingNodes.unselect();
                }
                existingNodes.forEach(function(node) {
                    var nodeObj = {
                        data: node.data(),
                        style: node.style()
                    }
                    applyEntityStyle(nodeObj.data.type, true, nodeObj);
                    node.data(nodeObj.data);
                    node.style(nodeObj.style);
                });
            } else {
                var cyNode = {
                     group: 'nodes',
                     data: {
                         id: id,
                         label: createLabel(id)
                     },
                     position: {
                         x: 100,
                         y: 100
                     },
                     selected: isSelected
                }
                applyEntityStyle(schema.entities[entity.group].vertex, true, cyNode);
                graphCy.add(cyNode);
            }
        }

        for (var id in results.edges) {
            var edge = results.edges[id][0];
            var existingNodes = graphCy.getElementById(edge.source);
            var isSelected = common.objectContainsValue(selectedEntities, edge.source);
            if(existingNodes.length > 0) {
                if(isSelected) {
                   existingNodes.select();
                } else {
                   existingNodes.unselect();
                }
                existingNodes.forEach(function(node) {
                    var nodeObj = {
                        data: node.data(),
                        style: node.style()
                    }
                    applyEntityStyle(schema.edges[edge.group].source, nodeObj.data.hasEntities, nodeObj);
                    node.data(nodeObj.data);
                    node.style(nodeObj.style);
                });
            } else {
                var cyNode = {
                    group: 'nodes',
                    data: {
                        id: edge.source,
                        label: createLabel(edge.source)
                    },
                    position: {
                        x: 100,
                        y: 100
                    },
                    selected:isSelected,
                }
                applyEntityStyle(schema.edges[edge.group].source, false, cyNode);
                graphCy.add(cyNode);
            }

            existingNodes = graphCy.getElementById(edge.destination);
            isSelected = common.objectContainsValue(selectedEntities, edge.destination);
            if(existingNodes.length > 0) {
                if(isSelected) {
                   existingNodes.select();
                } else {
                   existingNodes.unselect();
                }
                existingNodes.addClass(schema.edges[edge.group].destination);
            } else {
                var cyNode = {
                     group: 'nodes',
                     data: {
                         id: edge.destination,
                         label: createLabel(edge.destination)
                     },
                     position: {
                         x: 100,
                         y: 100
                     },
                     selected: isSelected
                };
                applyEntityStyle(schema.edges[edge.group].destination, false, cyNode);
                graphCy.add(cyNode);
            }

            var existingEdges = graphCy.getElementById(id);
            isSelected = common.objectContainsValue(selectedEdges, id);
            if(existingEdges.length > 0) {
                if(isSelected) {
                   existingEdges.select();
                } else {
                   existingEdges.unselect();
                }
            } else {
                var cyEdge = {
                     group: 'edges',
                     data: {
                         id: id,
                         source: edge.source,
                         target: edge.destination,
                         group: edge.group
                     },
                     selected: isSelected
                };
                applyEdgeStyle(edge.group, cyEdge);
                graphCy.add(cyEdge);
            }
        }
        graph.redraw();
    }

    /**
     * Removes all elements from the cytoscape graph - does not remove them from the model.
     */
    graph.clear = function(){
        graph.removeSelected();
        while(graphCy.elements().length > 0) {
            graphCy.remove(graphCy.elements()[0]);
        }
        input.reset();
    }

    /**
     * Redraws the cytoscape graph
     */
    graph.redraw = function() {
        if(graphCy) {
            var nodes = graphCy.nodes();
            for(var i in nodes) {
                if(nodes[i] && nodes[i].hasClass && nodes[i].hasClass("filtered")) {
                    nodes[i].remove();
                }
            }
            graphCy.layout(layoutConf);
        }
    }

    graph.filter = function(searchTerm) {
        searchTerm = searchTerm.toLowerCase();
        var nodes = graphCy.nodes();
        for(var i in nodes) {
            if(nodes[i].data && nodes[i].data('id')) {
                if(nodes[i].data('id').toLowerCase().indexOf(searchTerm) === -1) {
                    nodes[i].addClass("filtered");
                } else {
                    nodes[i].removeClass("filtered");
                }
            }
        }
    }

    graph.removeSelected = function() {
        graphCy.filter(":selected").remove();
        graphCy.elements().unselect();
        selectedEdges = {};
        selectedEntities = {};
        events.broadcast('selectedElementsUpdate', [{"entities": selectedEntities, "edges": selectedEdges}]);
    }

    /**
     * Helper method to create a label from a vertex
     * @param {String} vertex
     */
    var createLabel = function(vertex) {
        var label;
        var json;
        try {
            json = JSON.parse(vertex);
        } catch (e) {
            json = vertex;
        }
        if(typeof json === 'string'
            || json instanceof String
            || typeof json === 'number') {
            label = vertex;
        } else if(Object.keys(json).length == 1) {
            label = types.getShortValue(json);
        } else {
            label = vertex;
        }

        return label;
    }

    /**
     * Selects all nodes (entities)
     */
    graph.selectAllNodes = function() {
        graphCy.filter('node').select();
    }

    /**
     * Deselects all elements
     */
    graph.deselectAll = function() {
        graphCy.elements().unselect();
    }

    return graph;

}]);
