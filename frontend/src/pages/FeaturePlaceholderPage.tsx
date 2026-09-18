import { Empty, Typography } from "antd";
import styles from "./FeaturePlaceholderPage.module.css";

type FeaturePlaceholderPageProps = {
  title: string;
  description: string;
};

export function FeaturePlaceholderPage({
  title,
  description,
}: FeaturePlaceholderPageProps) {
  return (
    <div className={styles.page}>
      <Typography.Title>{title}</Typography.Title>
      <Typography.Paragraph type="secondary">
        {description}
      </Typography.Paragraph>
      <section className={styles.empty}>
        <Empty description="该模块将在对应业务竖切中实现" />
      </section>
    </div>
  );
}
