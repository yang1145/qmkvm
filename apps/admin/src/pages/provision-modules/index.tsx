/**
 * 供应模块管理页（PRD-billing F8 运维配套）：
 * 模块清单（支持动作/使用商品数）、使用商品抽屉、失败记录抽屉、连接测试弹窗。
 */
import { PageContainer, ProTable } from '@ant-design/pro-components';
import type { ActionType, ProColumns } from '@ant-design/pro-components';
import {
  ApiOutlined,
  ExclamationCircleOutlined,
  UnorderedListOutlined,
} from '@ant-design/icons';
import { useAccess } from '@umijs/max';
import {
  Alert,
  App,
  Button,
  Drawer,
  Input,
  Modal,
  Space,
  Table,
  Tag,
  Tooltip,
  Typography,
} from 'antd';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  getProvisionModuleFailures,
  getProvisionModuleProducts,
  getProvisionModules,
  testProvisionModule,
} from '@/services/admin';
import type {
  ProvisionModuleFailureItem,
  ProvisionModuleItem,
  ProvisionModuleProductItem,
} from '@/services/types';
import { PROVISION_ACTION_LABEL } from '@/services/enums';
import { formatDateTime } from '@/utils/format';
import { tableRequestAdapter, toQuery } from '@/utils/table';

const { Text, Paragraph } = Typography;

/** 动作 code → 中文标签（未知动作展示原值） */
function actionLabel(action: string): string {
  return PROVISION_ACTION_LABEL[action as keyof typeof PROVISION_ACTION_LABEL] ?? action;
}

/** http-api 示例配置（预填到连接测试弹窗） */
const HTTP_API_SAMPLE_CONFIG = `{
  "baseUrl": "https://api.example.com",
  "apiKey": "your-api-key",
  "hmacSecret": "",
  "timeoutMs": 120000,
  "actions": {
    "provision": { "method": "POST", "path": "/servers" },
    "suspend": { "method": "POST", "path": "/servers/{{service.id}}/suspend" },
    "unsuspend": { "method": "POST", "path": "/servers/{{service.id}}/unsuspend" },
    "terminate": { "method": "POST", "path": "/servers/{{service.id}}/terminate" },
    "change_package": { "method": "POST", "path": "/servers/{{service.id}}/change-package" }
  }
}`;

/** 无外部依赖的模块：连接测试直接成功，无需配置 */
const NO_CONFIG_CODES = new Set(['manual', 'demo']);

type TestResult = { ok: boolean; message: string | null } | null;

const ProvisionModulesPage: React.FC = () => {
  const access = useAccess();
  const { message } = App.useApp();

  const [modules, setModules] = useState<ProvisionModuleItem[]>([]);
  const [loading, setLoading] = useState(true);

  // 使用商品抽屉
  const [productsDrawerCode, setProductsDrawerCode] = useState<string | null>(null);
  const productsActionRef = useRef<ActionType | undefined>(undefined);

  // 失败记录抽屉
  const [failuresDrawerCode, setFailuresDrawerCode] = useState<string | null>(null);
  const [failures, setFailures] = useState<ProvisionModuleFailureItem[]>([]);
  const [failuresLoading, setFailuresLoading] = useState(false);

  // 连接测试弹窗
  const [testModule, setTestModule] = useState<ProvisionModuleItem | null>(null);
  const [configText, setConfigText] = useState('');
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<TestResult>(null);

  const loadModules = useCallback(async () => {
    setLoading(true);
    try {
      setModules(await getProvisionModules());
    } catch {
      // 错误提示由统一 errorHandler 处理
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadModules();
  }, [loadModules]);

  const openTestModal = (m: ProvisionModuleItem) => {
    setTestModule(m);
    setTestResult(null);
    setConfigText(NO_CONFIG_CODES.has(m.code) ? '' : HTTP_API_SAMPLE_CONFIG);
  };

  const doTest = async () => {
    if (!testModule) return;
    let config: Record<string, unknown> | null = null;
    if (!NO_CONFIG_CODES.has(testModule.code)) {
      try {
        config = JSON.parse(configText) as Record<string, unknown>;
      } catch {
        message.error('配置不是合法 JSON，请检查');
        return;
      }
    }
    setTesting(true);
    try {
      const res = await testProvisionModule(testModule.code, config);
      setTestResult({ ok: res.ok, message: res.message });
    } catch {
      // 请求失败（如无权限）由统一 errorHandler 提示
      setTestResult(null);
    } finally {
      setTesting(false);
    }
  };

  const openFailures = async (code: string) => {
    setFailuresDrawerCode(code);
    setFailuresLoading(true);
    try {
      setFailures(await getProvisionModuleFailures(code));
    } catch {
      setFailures([]);
    } finally {
      setFailuresLoading(false);
    }
  };

  const productColumns: ProColumns<ProvisionModuleProductItem>[] = [
    { title: 'ID', dataIndex: 'id', width: 70, search: false },
    { title: '商品名称', dataIndex: 'name', search: false },
    { title: 'slug', dataIndex: 'slug', search: false },
    {
      title: '状态',
      dataIndex: 'status',
      width: 90,
      search: false,
      render: (_, row) =>
        row.status === 'active' ? <Tag color="green">上架</Tag> : <Tag>下架</Tag>,
    },
    {
      title: '模块配置摘要',
      dataIndex: 'moduleConfigSummary',
      search: false,
      ellipsis: true,
      render: (_, row) =>
        row.moduleConfigSummary ? (
          <Tooltip title={row.moduleConfigSummary}>{row.moduleConfigSummary}</Tooltip>
        ) : (
          <Text type="secondary">未配置</Text>
        ),
    },
  ];

  const failureColumns = [
    { title: '任务 ID', dataIndex: 'taskId', width: 80 },
    { title: '服务名称', dataIndex: 'serviceName', ellipsis: true },
    {
      title: '动作',
      dataIndex: 'action',
      width: 100,
      render: (v: string) => actionLabel(v),
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 90,
      render: (v: string) =>
        v === 'dead' ? <Tag color="volcano">死信</Tag> : <Tag color="red">失败</Tag>,
    },
    {
      title: '错误',
      dataIndex: 'error',
      ellipsis: true,
      render: (v: string | null) =>
        v ? (
          <Tooltip title={v}>
            <Text type="danger">{v}</Text>
          </Tooltip>
        ) : (
          '-'
        ),
    },
    {
      title: '时间',
      dataIndex: 'createdAt',
      width: 170,
      render: (v: string) => formatDateTime(v),
    },
  ];

  const columns: ProColumns<ProvisionModuleItem>[] = [
    { title: '模块 code', dataIndex: 'code', width: 120 },
    { title: '名称', dataIndex: 'name', width: 190 },
    {
      title: '描述',
      dataIndex: 'description',
      ellipsis: true,
      render: (_, row) => row.description ?? <Text type="secondary">-</Text>,
    },
    {
      title: '支持动作',
      dataIndex: 'actions',
      width: 280,
      render: (_, row) => (
        <Space size={4} wrap>
          {(row.actions ?? []).map((a) => (
            <Tag key={a} color="blue">
              {actionLabel(a)}
            </Tag>
          ))}
        </Space>
      ),
    },
    {
      title: '使用商品数',
      dataIndex: 'productCount',
      width: 110,
      render: (_, row) => (row.productCount > 0 ? row.productCount : <Text type="secondary">0</Text>),
    },
    {
      title: '操作',
      valueType: 'option',
      width: 280,
      render: (_, row) => [
        <Button
          key="products"
          size="small"
          icon={<UnorderedListOutlined />}
          onClick={() => {
            setProductsDrawerCode(row.code);
            productsActionRef.current?.reload();
          }}
        >
          使用商品
        </Button>,
        access.canProductsManage ? (
          <Button
            key="test"
            size="small"
            icon={<ApiOutlined />}
            onClick={() => openTestModal(row)}
          >
            连接测试
          </Button>
        ) : null,
        <Button
          key="failures"
          size="small"
          icon={<ExclamationCircleOutlined />}
          onClick={() => openFailures(row.code)}
        >
          失败记录
        </Button>,
      ],
    },
  ];

  return (
    <PageContainer>
      <ProTable<ProvisionModuleItem>
        headerTitle="供应模块（供应任务按服务的 moduleCode 路由到对应模块执行）"
        rowKey="code"
        search={false}
        options={{ reload: () => loadModules() }}
        loading={loading}
        dataSource={modules}
        pagination={false}
        columns={columns}
      />

      <Drawer
        title={productsDrawerCode ? `使用商品：${productsDrawerCode}` : '使用商品'}
        width={820}
        open={productsDrawerCode !== null}
        onClose={() => setProductsDrawerCode(null)}
        destroyOnHidden
      >
        {productsDrawerCode && (
          <ProTable<ProvisionModuleProductItem>
            actionRef={productsActionRef}
            rowKey="id"
            search={false}
            request={async (params) => {
              const res = await getProvisionModuleProducts(
                productsDrawerCode,
                toQuery(params, { pageSize: 10 }),
              );
              return tableRequestAdapter(res);
            }}
            pagination={{ pageSize: 10 }}
            columns={productColumns}
          />
        )}
      </Drawer>

      <Drawer
        title={failuresDrawerCode ? `失败记录：${failuresDrawerCode}` : '失败记录'}
        width={900}
        open={failuresDrawerCode !== null}
        onClose={() => setFailuresDrawerCode(null)}
        destroyOnHidden
      >
        <Paragraph type="secondary">
          最近 10 条该模块的失败/死信供应任务（按服务的 moduleCode 匹配），用于排查面板对接问题。
        </Paragraph>
        <Table
          rowKey="taskId"
          size="small"
          loading={failuresLoading}
          dataSource={failures}
          pagination={false}
          columns={failureColumns}
          locale={{ emptyText: '暂无失败/死信任务' }}
        />
      </Drawer>

      <Modal
        title={testModule ? `连接测试：${testModule.name}（${testModule.code}）` : '连接测试'}
        open={testModule !== null}
        onCancel={() => setTestModule(null)}
        footer={
          <Space>
            <Button onClick={() => setTestModule(null)}>关闭</Button>
            {access.canProductsManage && (
              <Button type="primary" loading={testing} onClick={() => void doTest()}>
                测试
              </Button>
            )}
          </Space>
        }
        destroyOnHidden
      >
        {testModule && NO_CONFIG_CODES.has(testModule.code) && (
          <Alert
            type="info"
            showIcon
            message={`「${testModule.code}」模块无外部依赖，无需配置；点击「测试」将直接返回成功说明。`}
            style={{ marginBottom: 12 }}
          />
        )}
        {testModule && !NO_CONFIG_CODES.has(testModule.code) && (
          <div style={{ marginBottom: 12 }}>
            <div style={{ marginBottom: 4 }}>
              <Text type="secondary">模块配置 JSON（对应商品 moduleConfig，可参考示例结构）：</Text>
            </div>
            <Input.TextArea
              value={configText}
              onChange={(e) => setConfigText(e.target.value)}
              rows={14}
              style={{ fontFamily: 'monospace' }}
            />
          </div>
        )}
        {testResult &&
          (testResult.ok ? (
            <Alert
              type="success"
              showIcon
              message="连接成功"
              description={testResult.message ?? undefined}
            />
          ) : (
            <Alert
              type="error"
              showIcon
              message="连接失败"
              description={testResult.message ?? undefined}
            />
          ))}
      </Modal>
    </PageContainer>
  );
};

export default ProvisionModulesPage;
