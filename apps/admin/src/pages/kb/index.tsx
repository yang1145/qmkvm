/**
 * 知识库管理：分类管理 + 文章管理（发布/可见性/浏览量）
 */
import { PageContainer, ProTable } from '@ant-design/pro-components';
import { useAccess } from '@umijs/max';
import type { ActionType, ProColumns } from '@ant-design/pro-components';
import {
  App,
  Button,
  Drawer,
  Form,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Select,
  Space,
  Switch,
  Tag,
} from 'antd';
import { useEffect, useRef, useState } from 'react';
import type React from 'react';
import {
  createKbArticle,
  createKbCategory,
  deleteKbArticle,
  deleteKbCategory,
  getKbArticle,
  getKbArticles,
  getKbCategories,
  updateKbArticle,
  updateKbCategory,
} from '@/services/admin';
import type { KbArticleDetail, KbArticleListItem, KbCategoryItem } from '@/services/types';
import { tableRequestAdapter } from '@/utils/table';
import { formatDateTime } from '@/utils/format';

type ArticleForm = {
  id?: number;
  title: string;
  slug: string;
  categoryId?: number;
  visibility: 'public' | 'login';
  published: boolean;
  contentHtml: string;
};

const KbPage: React.FC = () => {
  const actionRef = useRef<ActionType | undefined>(undefined);
  const access = useAccess();
  const { message, modal } = App.useApp();

  const [categories, setCategories] = useState<KbCategoryItem[]>([]);
  const [catModalOpen, setCatModalOpen] = useState(false);
  const [catEditing, setCatEditing] = useState<KbCategoryItem | null>(null);
  const [catForm, setCatForm] = useState({ name: '', slug: '', sortOrder: 0 });

  const [articleOpen, setArticleOpen] = useState(false);
  const [articleSaving, setArticleSaving] = useState(false);
  const [article, setArticle] = useState<ArticleForm | null>(null);

  const loadCategories = () => {
    getKbCategories()
      .then((res) => setCategories(res.items ?? []))
      .catch(() => {});
  };
  useEffect(() => {
    loadCategories();
  }, []);

  const catColumns: ProColumns<KbCategoryItem>[] = [
    { title: 'ID', dataIndex: 'id', width: 60, search: false },
    { title: '名称', dataIndex: 'name' },
    { title: 'Slug', dataIndex: 'slug', search: false },
    { title: '文章数', dataIndex: 'articleCount', width: 80, search: false },
    { title: '排序', dataIndex: 'sortOrder', width: 70, search: false },
    {
      title: '操作',
      width: 130,
      search: false,
      render: (_, r) => (
        <Space size={8}>
          <Button
            size="small"
            type="link"
            onClick={() => {
              setCatEditing(r);
              setCatForm({ name: r.name, slug: r.slug, sortOrder: r.sortOrder });
              setCatModalOpen(true);
            }}
          >
            编辑
          </Button>
          <Popconfirm
            title="删除分类？"
            description="存在文章时无法删除"
            onConfirm={async () => {
              try {
                await deleteKbCategory(r.id);
                message.success('已删除');
                loadCategories();
              } catch (e) {
                message.error(e instanceof Error ? e.message : '删除失败');
              }
            }}
          >
            <Button size="small" type="link" danger>
              删除
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  const articleColumns: ProColumns<KbArticleListItem>[] = [
    { title: 'ID', dataIndex: 'id', width: 60, search: false },
    { title: '标题', dataIndex: 'title', ellipsis: true },
    { title: 'Slug', dataIndex: 'slug', search: false, ellipsis: true },
    {
      title: '分类',
      dataIndex: 'categoryId',
      width: 110,
      valueType: 'select',
      fieldProps: { options: categories.map((c) => ({ value: c.id, label: c.name })) },
      render: (_, r) => r.categoryName ?? '-',
    },
    {
      title: '可见性',
      dataIndex: 'visibility',
      width: 90,
      valueType: 'select',
      fieldProps: {
        options: [
          { value: 'public', label: '公开' },
          { value: 'login', label: '登录可见' },
        ],
      },
      render: (_, r) =>
        r.visibility === 'public' ? <Tag color="green">公开</Tag> : <Tag color="blue">登录可见</Tag>,
    },
    {
      title: '已发布',
      dataIndex: 'published',
      width: 80,
      search: false,
      render: (_, r) => (r.published ? <Tag color="green">是</Tag> : <Tag color="default">否</Tag>),
    },
    { title: '浏览', dataIndex: 'views', width: 70, search: false },
    { title: '更新时间', dataIndex: 'updatedAt', width: 150, search: false, render: (_, r) => formatDateTime(r.updatedAt) },
    {
      title: '操作',
      width: 130,
      search: false,
      render: (_, r) => (
        <Space size={8}>
          <Button size="small" type="link" onClick={() => openArticle(r.id)}>
            编辑
          </Button>
          <Popconfirm
            title="删除文章？"
            onConfirm={async () => {
              try {
                await deleteKbArticle(r.id);
                message.success('已删除');
                actionRef.current?.reload();
                loadCategories();
              } catch (e) {
                message.error(e instanceof Error ? e.message : '删除失败');
              }
            }}
          >
            <Button size="small" type="link" danger>
              删除
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  const openArticle = async (id: number) => {
    try {
      const detail: KbArticleDetail = await getKbArticle(id);
      setArticle({
        id: detail.id,
        title: detail.title,
        slug: detail.slug,
        categoryId: detail.categoryId,
        visibility: detail.visibility,
        published: detail.published,
        contentHtml: detail.contentHtml,
      });
      setArticleOpen(true);
    } catch (e) {
      message.error(e instanceof Error ? e.message : '加载失败');
    }
  };

  const saveArticle = async () => {
    if (!article) return;
    if (!article.title.trim() || !article.slug.trim()) {
      message.warning('标题与 Slug 必填');
      return;
    }
    setArticleSaving(true);
    try {
      const payload = { ...article };
      if (article.id) {
        await updateKbArticle(article.id, payload);
      } else {
        await createKbArticle(payload);
      }
      message.success('已保存');
      setArticleOpen(false);
      setArticle(null);
      actionRef.current?.reload();
      loadCategories();
    } catch (e) {
      message.error(e instanceof Error ? e.message : '保存失败');
    } finally {
      setArticleSaving(false);
    }
  };

  const saveCategory = async () => {
    if (!catForm.name.trim()) {
      message.warning('名称必填');
      return;
    }
    try {
      if (catEditing) {
        await updateKbCategory(catEditing.id, catForm);
      } else {
        await createKbCategory(catForm);
      }
      message.success('已保存');
      setCatModalOpen(false);
      setCatEditing(null);
      loadCategories();
    } catch (e) {
      message.error(e instanceof Error ? e.message : '保存失败');
    }
  };

  return (
    <PageContainer
      title="知识库"
      subTitle="帮助中心文章与分类管理"
    >
      <ProTable<KbArticleListItem>
        rowKey="id"
        headerTitle="文章列表"
        actionRef={actionRef}
        columns={articleColumns}
        search={false}
        request={async (params) => {
          const res = await getKbArticles({
            page: params.current ?? 1,
            pageSize: params.pageSize ?? 20,
            categoryId: params.categoryId,
            visibility: params.visibility,
          });
          return tableRequestAdapter(res);
        }}
        pagination={{ defaultPageSize: 20 }}
        toolBarRender={() => [
          access.canKbManage && (
            <Button
              key="newArticle"
              type="primary"
              onClick={() => {
                setArticle({
                  title: '',
                  slug: '',
                  categoryId: categories[0]?.id,
                  visibility: 'public',
                  published: false,
                  contentHtml: '',
                });
                setArticleOpen(true);
              }}
            >
              新建文章
            </Button>
          ),
        ].filter(Boolean)}
      />

      <div style={{ marginTop: 24 }}>
        <ProTable<KbCategoryItem>
          rowKey="id"
          headerTitle="分类管理"
          columns={catColumns}
          search={false}
          dataSource={categories}
          pagination={false}
          toolBarRender={() => [
            access.canKbManage && (
              <Button
                key="newCat"
                onClick={() => {
                  setCatEditing(null);
                  setCatForm({ name: '', slug: '', sortOrder: 0 });
                  setCatModalOpen(true);
                }}
              >
                新建分类
              </Button>
            ),
          ].filter(Boolean)}
        />
      </div>

      <Modal
        title={catEditing ? '编辑分类' : '新建分类'}
        open={catModalOpen}
        onOk={saveCategory}
        onCancel={() => setCatModalOpen(false)}
        okText="保存"
      >
        <Form layout="vertical">
          <Form.Item label="名称" required>
            <Input
              value={catForm.name}
              onChange={(e) => setCatForm({ ...catForm, name: e.target.value })}
              placeholder="如：账户与安全"
            />
          </Form.Item>
          <Form.Item label="Slug" extra="留空可由后端生成或自行填写英文标识">
            <Input
              value={catForm.slug}
              onChange={(e) => setCatForm({ ...catForm, slug: e.target.value })}
              placeholder="account"
            />
          </Form.Item>
          <Form.Item label="排序">
            <InputNumber
              min={0}
              value={catForm.sortOrder}
              onChange={(v) => setCatForm({ ...catForm, sortOrder: v ?? 0 })}
              style={{ width: 120 }}
            />
          </Form.Item>
        </Form>
      </Modal>

      <Drawer
        title={article?.id ? '编辑文章' : '新建文章'}
        width={760}
        open={articleOpen}
        onClose={() => {
          setArticleOpen(false);
          setArticle(null);
        }}
        destroyOnClose
        extra={
          <Space>
            <Button onClick={() => setArticleOpen(false)}>取消</Button>
            <Button type="primary" loading={articleSaving} onClick={saveArticle}>
              保存
            </Button>
          </Space>
        }
      >
        {article && (
          <Form layout="vertical">
            <Form.Item label="标题" required>
              <Input
                value={article.title}
                onChange={(e) => setArticle({ ...article, title: e.target.value })}
              />
            </Form.Item>
            <Form.Item label="Slug" required extra="URL 标识，如 how-to-renew">
              <Input
                value={article.slug}
                onChange={(e) => setArticle({ ...article, slug: e.target.value })}
              />
            </Form.Item>
            <Form.Item label="分类">
              <Select
                value={article.categoryId}
                options={categories.map((c) => ({ value: c.id, label: c.name }))}
                onChange={(v) => setArticle({ ...article, categoryId: v })}
              />
            </Form.Item>
            <Form.Item label="可见性">
              <Select
                value={article.visibility}
                options={[
                  { value: 'public', label: '公开（未登录可见）' },
                  { value: 'login', label: '登录可见' },
                ]}
                onChange={(v) => setArticle({ ...article, visibility: v })}
              />
            </Form.Item>
            <Form.Item label="发布">
              <Switch
                checked={article.published}
                onChange={(v) => setArticle({ ...article, published: v })}
              />
            </Form.Item>
            <Form.Item label="正文（HTML）" extra="支持 HTML 标签；{{变量}} 语法仅通知模板可用">
              <Input.TextArea
                rows={16}
                value={article.contentHtml}
                onChange={(e) => setArticle({ ...article, contentHtml: e.target.value })}
                placeholder="<p>正文内容…</p>"
              />
            </Form.Item>
          </Form>
        )}
      </Drawer>
    </PageContainer>
  );
};

export default KbPage;
