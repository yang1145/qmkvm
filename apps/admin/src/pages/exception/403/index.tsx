import { Link } from '@umijs/max';
import { Button, Card, Result } from 'antd';
import React from 'react';

const Exception403: React.FC = () => (
  <Card variant="borderless">
    <Result
      status="403"
      title="403"
      subTitle="抱歉，你没有权限访问该页面。"
      extra={
        <Link to="/">
          <Button type="primary">返回首页</Button>
        </Link>
      }
    />
  </Card>
);

export default Exception403;