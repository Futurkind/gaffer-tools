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
 * Schema view service which handles selected elements and a cytoscape schemaView
 */
angular.module('app').factory('schemaView', ['types', '$q', 'common', 'events', 'schema', function(types, $q, common, events, schemaService) {

    var schemaCy;
    var schemaView = {};

    var selectedVertices = [];
    var selectedEdges = [];

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
                'min-zoomed-font-size': 10,
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

    var layoutConf = {
        name: 'cytoscape-ngraph.forcelayout',
        async: {
            maxIterations: 1000,
            stepsPerCycle: 50,
            waitForStep: true
        },
        physics: {
            springLength: 250,
            fit: true
        },
        iterations: 10000,
        fit: true,
        animate: false
    };

    schemaService.getStyle().then(function(schemaStyle) {
        angular.merge(style, angular.copy(schemaStyle));
    });

    /**
     * Loads cytoscape schemaView onto an element containing the "schemaCy" id. It also registers the 
     * handlers for select and deselect events.
     */
    schemaView.load = function() {
        var deferred = $q.defer();
        schemaCy = cytoscape({
            container: $('#schemaCy')[0],
            style: [
                {
                    selector: 'node',
                    style: {
                        'content': 'data(label)',
                        'background-color': 'data(defaultColor)',
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
                        'background-color': 'data(selectedColor)',
                    }
                },
                {
                    selector: 'edge:selected',
                     css: {
                        'line-color': 'data(selectedColor)',
                        'target-arrow-color': 'data(selectedColor)',
                        'text-outline-color': 'data(selectedColor)'
                    }
                }
            ],
            layout: layoutConf,
            elements: [],
            ready: function(){
                deferred.resolve( this );
            }
        });

        schemaCy.on('select', function(evt){
            select(evt.cyTarget);
        });

        schemaCy.on('unselect', function(evt){
            deselect(evt.cyTarget);
        })

        return deferred.promise;
    }

    var select = function(element) {
        if("nodes" === element.group()) {
            if(selectedVertices.indexOf(element.id()) === -1) {
                selectedVertices.push(element.id());
            }
        } else {
            if(selectedEdges.indexOf(element.data().group) === -1) {
                selectedEdges.push(element.data().group);
            }
        }
        events.broadcast('selectedSchemaElementGroupsUpdate', [{vertices: selectedVertices, edges: selectedEdges}]);
    }

    var deselect = function(element) {
        if("nodes" === element.group()) {
            var index = selectedVertices.indexOf(element.id());
            if (index !== -1) {
                selectedVertices.splice(index, 1);
            }
        } else {
            var index = selectedEdges.indexOf(element.data().group);
            if (index !== -1) {
                selectedEdges.splice(index, 1);
            }
        }
        events.broadcast('selectedSchemaElementGroupsUpdate', [{vertices: selectedVertices, edges: selectedEdges}]);
    }

    /**
     * Updates the cytoscape graph and redraws it
     */
    schemaView.reload = function(schema) {
        updateGraph(schema);
        redraw();
    }

    var redraw = function() {
        schemaCy.layout(layoutConf);
    }

    var updateGraph = function(schema) {
        var nodes = [];

        for(var group in schema.entities) {
            if(nodes.indexOf(schema.entities[group].vertex) === -1) {
                nodes.push(schema.entities[group].vertex);
            }
        }

        for(var i in nodes) {
            var cyNode = {
               group: 'nodes',
               data: {
                   id: nodes[i],
                   label: nodes[i],
               }
           }
           applyEntityStyle(nodes[i], true, cyNode);
           schemaCy.add(cyNode);
        }

        for(var group in schema.edges) {
            var edge = schema.edges[group];
            if(nodes.indexOf(edge.source) === -1) {
                nodes.push(edge.source);
                var cyNode = {
                     group: 'nodes',
                     data: {
                         id: edge.source,
                         label: edge.source
                     }
                }
                applyEntityStyle(edge.source, false, cyNode);
                schemaCy.add(cyNode);
            }
            if(nodes.indexOf(edge.destination) === -1) {
                nodes.push(edge.destination);
                var cyNode = {
                     group: 'nodes',
                     data: {
                         id: edge.destination,
                         label: edge.destination
                     }
                 }
                applyEntityStyle(edge.destination, false, cyNode);
                schemaCy.add(cyNode);
            }

            var cyEdge = {
                 group: 'edges',
                 data: {
                     id: edge.source + "|" + edge.destination + "|" + edge.directed + "|" + group,
                     source: edge.source,
                     target: edge.destination,
                     group: group
                 }
            };
            applyEdgeStyle(group, cyEdge);
            schemaCy.add(cyEdge);
        }
    }

    return schemaView;
}]);
