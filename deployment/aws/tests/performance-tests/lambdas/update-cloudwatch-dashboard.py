#!/usr/bin/env python

import boto3
import json
import os
import time

TEMPLATE_TYPE = "gaffer-performance-tests"
GAFFER_GRAPH_ID = "gaffer_performance_test"

session = boto3.session.Session()
REGION = session.region_name

autoscaling = boto3.client('autoscaling')
cloudformation = boto3.client('cloudformation')
cloudwatch = boto3.client('cloudwatch')
ec2 = boto3.client('ec2')
emr = boto3.client('emr')

def convertStackOutputsToDict (stack):
    outputs = {}
    for output in stack['Outputs']:
        outputs[output['OutputKey']] = output['OutputValue']
    stack['Outputs'] = outputs
    return stack

CURRENT_Y = 0
CURRENT_MAX_Y = 1
CURRENT_X = 0
MAX_X = 24

def header (markdown):
    global CURRENT_X, CURRENT_Y, CURRENT_MAX_Y, MAX_X

    if CURRENT_X > 0:
        CURRENT_X = 0
        CURRENT_Y += CURRENT_MAX_Y
        CURRENT_MAX_Y = 1

    header = {
        "type": "text",
        "x": CURRENT_X,
        "y": CURRENT_Y,
        "width": MAX_X,
        "height": 1,
        "properties": {
            "markdown": markdown
        }
    }

    CURRENT_Y += 1

    return header

def graph (title, metrics, width = 8, height = 6, stacked = False):
    global CURRENT_X, CURRENT_Y, CURRENT_MAX_Y, MAX_X

    if CURRENT_X + width > MAX_X:
        CURRENT_X = 0
        CURRENT_Y += CURRENT_MAX_Y
        CURRENT_MAX_Y = 1

    graph = {
        "type": "metric",
        "x": CURRENT_X,
        "y": CURRENT_Y,
        "width": width,
        "height": height,
        "properties": {
            "title": title,
            "metrics": metrics,
            "period": 60,
            "region": REGION,
            "stat": "Average",
            "view": "timeSeries",
            "stacked": stacked
        }
    }

    CURRENT_X += width
    if height > CURRENT_MAX_Y:
        CURRENT_MAX_Y = height

    return graph

def ec2Graph (title, metricName, instanceIds, width = 8, height = 6, stacked = False):
    metrics = []
    for instanceId in instanceIds:
        metrics.append([
            "AWS/EC2", metricName,
            "InstanceId", instanceId,
            { "label": instanceId }
        ])
    return graph(title, metrics, width=width, height=height, stacked=stacked)

def accumuloTabletServerGraph (title, metricName, emrPrivateDnsNames, emrClusterId, accumuloInstanceName, width = 8, height = 6, stacked = True):
    metrics = []
    for emrPrivateDnsName in emrPrivateDnsNames:
        metrics.append([
            "Accumulo", metricName,
            "EmrJobFlowId", emrClusterId,
            "InstanceName", accumuloInstanceName,
            "TableName", GAFFER_GRAPH_ID,
            "TabletServerName", emrPrivateDnsName,
            { "label": emrPrivateDnsName }
        ])
    return graph(title, metrics, width=width, height=height, stacked=stacked)

def ensureDetailedMonitoringEnabled (instanceIds):
    enableMonitoringInstanceIds = []

    emrInstancesWithBasicMonitoringResponse = ec2.describe_instances(InstanceIds=instanceIds, Filters=[{
        'Name': 'monitoring-state',
        'Values': ['disabled']
    }])

    if 'Reservations' in emrInstancesWithBasicMonitoringResponse:
        for reservation in emrInstancesWithBasicMonitoringResponse['Reservations']:
            for instance in reservation['Instances']:
                enableMonitoringInstanceIds.append(instance['InstanceId'])

    if len(enableMonitoringInstanceIds) > 0:
        print('Enabling detailed monitoring for: ' + str(enableMonitoringInstanceIds))
        ec2.monitor_instances(InstanceIds=enableMonitoringInstanceIds)

def updateDashboardForStack (stack):
    dataGenScalingGrpName = stack['Outputs']['DataGeneratorAutoScalingGroupName']
    queryGenScalingGrpName = stack['Outputs']['QueryGeneratorAutoScalingGroupName']

    dataGenInstanceIds = []
    dataGenGrpResponse = autoscaling.describe_auto_scaling_groups(AutoScalingGroupNames=[dataGenScalingGrpName])
    for instance in dataGenGrpResponse['AutoScalingGroups'][0]['Instances']:
        dataGenInstanceIds.append(instance['InstanceId'])

    queryGenInstanceIds = []
    queryGenGrpResponse = autoscaling.describe_auto_scaling_groups(AutoScalingGroupNames=[queryGenScalingGrpName])
    for instance in queryGenGrpResponse['AutoScalingGroups'][0]['Instances']:
        queryGenInstanceIds.append(instance['InstanceId'])

    emrInstanceIds = []
    emrPrivateDnsNames = []
    emrInstancesResponse = emr.list_instances(ClusterId=stack['Outputs']['EmrClusterId'])
    for instance in emrInstancesResponse['Instances']:
        emrInstanceIds.append(instance['Ec2InstanceId'])
        if 'PrivateDnsName' in instance:
            emrPrivateDnsNames.append(instance['PrivateDnsName'])

    if len(emrInstanceIds) > 0:
        ensureDetailedMonitoringEnabled(emrInstanceIds)

    # ===== =====

    dataGenIngestRateMetrics = []
    for dataGenInstanceId in dataGenInstanceIds:
        dataGenIngestRateMetrics.append([
            "Gaffer", "elements_per_second_batch",
            "EmrJobFlowId", stack['Outputs']['EmrClusterId'],
            "InstanceId", dataGenInstanceId,
            "InstanceName", stack['Outputs']['AccumuloInstanceName'],
            "TableName", GAFFER_GRAPH_ID,
            { "label": dataGenInstanceId }
        ])

    dataGenGroupSizeMetric = [
        "AWS/AutoScaling", "GroupInServiceInstances",
        "AutoScalingGroupName", stack['Outputs']['DataGeneratorAutoScalingGroupName']
    ]

    queryGenSeedRateMetrics = []
    queryGenResultsRateMetrics = []
    for queryGenInstanceId in queryGenInstanceIds:
        queryGenSeedRateMetrics.append([
            "Gaffer", "seeds_per_second",
            "EmrJobFlowId", stack['Outputs']['EmrClusterId'],
            "InstanceId", queryGenInstanceId,
            "InstanceName", stack['Outputs']['AccumuloInstanceName'],
            "TableName", GAFFER_GRAPH_ID,
            { "label": queryGenInstanceId }
        ])
        queryGenResultsRateMetrics.append([
            "Gaffer", "results_per_second",
            "EmrJobFlowId", stack['Outputs']['EmrClusterId'],
            "InstanceId", queryGenInstanceId,
            "InstanceName", stack['Outputs']['AccumuloInstanceName'],
            "TableName", GAFFER_GRAPH_ID,
            { "label": queryGenInstanceId }
        ])

    queryGenGroupSizeMetric = [
        "AWS/AutoScaling", "GroupInServiceInstances",
        "AutoScalingGroupName", stack['Outputs']['QueryGeneratorAutoScalingGroupName']
    ]

    emrHdfsMetrics = [
        [
            "AWS/ElasticMapReduce", "HDFSUtilization",
            "JobFlowId", stack['Outputs']['EmrClusterId']
        ],
        [
            "AWS/ElasticMapReduce", "CapacityRemainingGB",
            "JobFlowId", stack['Outputs']['EmrClusterId'],
            { "yAxis": "right" }
        ]
    ]

    # ===== =====

    widgets = [
        header("WARNING: This dashboard gets auto-updated by a Lambda function every minute! (Last Updated: " + time.ctime() + ")"),

        header("** GENERATOR METRICS **"),
        graph("Data Generator Instance Count", [dataGenGroupSizeMetric], width=6),
        ec2Graph("Data Generator CPU", "CPUUtilization", dataGenInstanceIds, width = 6),
        ec2Graph("Data Generator NetOut", "NetworkOut", dataGenInstanceIds, width = 6),
        graph("Data Generator Ingest Rate", dataGenIngestRateMetrics, width=6),

        graph("Query Generator Instance Count", [queryGenGroupSizeMetric], width=4),
        ec2Graph("Query Generator CPU", "CPUUtilization", queryGenInstanceIds, width = 5),
        ec2Graph("Query Generator NetOut", "NetworkOut", queryGenInstanceIds, width = 5),
        graph("Query Generator Seed Rate", queryGenSeedRateMetrics, width=5),
        graph("Query Generator Results Rate", queryGenResultsRateMetrics, width=5),

        header("** EMR CLUSTER METRICS **"),
        ec2Graph("EMR CPU", "CPUUtilization", emrInstanceIds),
        ec2Graph("EMR NetIn", "NetworkIn", emrInstanceIds),
        ec2Graph("EMR NetOut", "NetworkOut", emrInstanceIds),

        ec2Graph("EMR Disk Read Bytes", "DiskReadBytes", emrInstanceIds, width=6),
        ec2Graph("EMR Disk Read Ops", "DiskReadOps", emrInstanceIds, width=6),
        ec2Graph("EMR Disk Write Bytes", "DiskWriteBytes", emrInstanceIds, width=6),
        ec2Graph("EMR Disk Write Ops", "DiskWriteOps", emrInstanceIds, width=6),

        header("** ACCUMULO METRICS **"),
        accumuloTabletServerGraph("Online Tablets", "OnlineTabletCount", emrPrivateDnsNames, stack['Outputs']['EmrClusterId'], stack['Outputs']['AccumuloInstanceName'], width=6),
        accumuloTabletServerGraph("Records", "RecordCount", emrPrivateDnsNames, stack['Outputs']['EmrClusterId'], stack['Outputs']['AccumuloInstanceName'], width=6),
        accumuloTabletServerGraph("Records In Memory", "RecordsInMemoryCount", emrPrivateDnsNames, stack['Outputs']['EmrClusterId'], stack['Outputs']['AccumuloInstanceName'], width=6),
        graph("HDFS Usage", emrHdfsMetrics, width=6),

        accumuloTabletServerGraph("Ingest Rate", "IngestRate", emrPrivateDnsNames, stack['Outputs']['EmrClusterId'], stack['Outputs']['AccumuloInstanceName']),
        accumuloTabletServerGraph("Calculated Ingest Rate", "CalculatedIngestRate", emrPrivateDnsNames, stack['Outputs']['EmrClusterId'], stack['Outputs']['AccumuloInstanceName']),
        accumuloTabletServerGraph("Ingest Byte Rate", "IngestByteRate", emrPrivateDnsNames, stack['Outputs']['EmrClusterId'], stack['Outputs']['AccumuloInstanceName']),

        accumuloTabletServerGraph("Scan Rate", "ScanRate", emrPrivateDnsNames, stack['Outputs']['EmrClusterId'], stack['Outputs']['AccumuloInstanceName']),
        accumuloTabletServerGraph("Query Rate", "QueryRate", emrPrivateDnsNames, stack['Outputs']['EmrClusterId'], stack['Outputs']['AccumuloInstanceName']),
        accumuloTabletServerGraph("Query Byte Rate", "QueryByteRate", emrPrivateDnsNames, stack['Outputs']['EmrClusterId'], stack['Outputs']['AccumuloInstanceName']),

        accumuloTabletServerGraph("Minor Compactions", "MinorCompactionCount", emrPrivateDnsNames, stack['Outputs']['EmrClusterId'], stack['Outputs']['AccumuloInstanceName'], width=12),
        accumuloTabletServerGraph("Major Compactions", "MajorCompactionCount", emrPrivateDnsNames, stack['Outputs']['EmrClusterId'], stack['Outputs']['AccumuloInstanceName'], width=12),
        accumuloTabletServerGraph("Queued Minor Compactions", "MinorCompactionQueuedCount", emrPrivateDnsNames, stack['Outputs']['EmrClusterId'], stack['Outputs']['AccumuloInstanceName'], width=12),
        accumuloTabletServerGraph("Queued Major Compactions", "MajorCompactionQueuedCount", emrPrivateDnsNames, stack['Outputs']['EmrClusterId'], stack['Outputs']['AccumuloInstanceName'], width=12),
    ]

    dashboard = { "widgets": widgets }
    # print(json.dumps(dashboard, sort_keys=True, indent=2))

    stackName = stack['StackName']
    dashboardResponse = cloudwatch.put_dashboard(DashboardName=stackName, DashboardBody=json.dumps(dashboard))
    return dashboardResponse

def getPerformanceTestingStack (stackName):
    describeStacksResponse = cloudformation.describe_stacks(StackName = stackName)
    return convertStackOutputsToDict(describeStacksResponse['Stacks'][0])

def getAllPerformanceTestingStacks ():
    gafferPerfTestStacks = []
    describeStacksResponse = cloudformation.describe_stacks()
    for stack in describeStacksResponse['Stacks']:
        if 'Outputs' in stack:
            for output in stack['Outputs']:
                if output['OutputKey'] == 'GafferTemplateType' and output['OutputValue'] == TEMPLATE_TYPE:
                    gafferPerfTestStacks.append(convertStackOutputsToDict(stack))
    return gafferPerfTestStacks

def lambda_handler (evt, cntx):
    print(evt)

    if 'STACK_NAME' in os.environ:
        stack = getPerformanceTestingStack(os.environ['STACK_NAME'])
        # print(stack['Outputs'])

        result = updateDashboardForStack(stack)
        print(stack['StackName'] + ': ' + str(result))
        return result
    else:
        raise Exception('Missing env var STACK_NAME!')

if __name__ == "__main__":
    stacks = getAllPerformanceTestingStacks()
    for stack in stacks:
        # print(stack['Outputs'])
        result = updateDashboardForStack(stack)
        print(stack['StackName'] + ': ' + str(result))
